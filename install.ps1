# Installs or updates house-rules on Windows: picks a JavaScript runtime,
# fetches the checkout, creates a starter config when there is none, and
# composes the rules file and skills. It never edits agent host files and
# deletes only the temporary skills copy it built when that copy matches the
# installed one.
#
#   irm https://raw.githubusercontent.com/bompus/house-rules/main/install.ps1 | iex
#
# Runtime: the newest Bun 1.4 or later found on PATH or in a version manager's
# directory, otherwise the newest Node.js 22 or later.
#
# Environment:
#   HOUSE_RULES_DIR         checkout (default %LOCALAPPDATA%\house-rules)
#   HOUSE_RULES_CONFIG_DIR  personal layer (default %USERPROFILE%\.config\house-rules)
#   HOUSE_RULES_REPO        clone URL (default https://github.com/bompus/house-rules.git)
#   HOUSE_RULES_RUNTIME     path to the bun or node binary to use instead of searching
#
# Option: -PrintRuntime prints the chosen runtime and exits.

param([switch]$PrintRuntime)

# Everything runs inside this script block, so nothing it defines stays in the
# caller's session and a partial download runs nothing.
& {
  $ErrorActionPreference = 'Stop'

  function Fail([string]$Message) {
    throw "house-rules install: $Message"
  }

  # Runs a native command with its output on the console; returns the exit code.
  function Invoke-Native([string]$Exe, [string[]]$Arguments) {
    $ErrorActionPreference = 'Continue'
    & $Exe @Arguments | Out-Host
    $LASTEXITCODE
  }

  # "v22.1.0", "1.4.2" or "1.5.0-canary.1" -> [version] 22.1.0, 1.4.2, 1.5.0.
  function Get-RuntimeVersion([string]$Exe) {
    $ErrorActionPreference = 'Continue'
    try {
      $out = & $Exe --version 2>$null | Select-Object -First 1
    } catch {
      return $null
    }
    if ("$out" -match '^v?(\d+)\.(\d+)\.(\d+)') {
      return [version]"$($Matches[1]).$($Matches[2]).$($Matches[3])"
    }
    $null
  }

  # Every bun or node on PATH and in common version-manager directories.
  function Find-Runtime([string]$Name) {
    $found = @()
    foreach ($c in @(Get-Command $Name -All -CommandType Application -ErrorAction SilentlyContinue)) {
      $found += $c.Source
    }
    $scoop = if ($env:SCOOP) { $env:SCOOP } else { "$env:USERPROFILE\scoop" }
    $mise = if ($env:MISE_DATA_DIR) { $env:MISE_DATA_DIR } else { "$env:LOCALAPPDATA\mise" }
    $proto = "$env:USERPROFILE\.proto\tools"
    if ($Name -eq 'bun') {
      $roots = @("$env:USERPROFILE\.bun\bin", "$scoop\apps\bun\*", "$mise\installs\bun\*", "$proto\bun\*")
    } else {
      $nvm = if ($env:NVM_HOME) { $env:NVM_HOME } else { "$env:APPDATA\nvm" }
      $fnm = if ($env:FNM_DIR) { $env:FNM_DIR } else { "$env:APPDATA\fnm" }
      $roots = @("$nvm\v*", "$fnm\node-versions\*\installation", "$env:LOCALAPPDATA\Volta\tools\image\node\*",
        "$scoop\apps\nodejs*\*", "$mise\installs\node\*", "$proto\node\*")
    }
    foreach ($root in $roots) {
      foreach ($leaf in @("$Name.exe", "$Name.cmd", "bin\$Name.exe", "bin\$Name.cmd")) {
        foreach ($f in @(Get-ChildItem -Path "$root\$leaf" -File -ErrorAction SilentlyContinue)) {
          $found += $f.FullName
        }
      }
    }
    $found | Select-Object -Unique
  }

  # The newest $Name at version $Min or later, or $null.
  function Select-Newest([string]$Name, [version]$Min) {
    $best = $null
    $bestVersion = $null
    foreach ($c in @(Find-Runtime $Name)) {
      $v = Get-RuntimeVersion $c
      if ($v -and $v -ge $Min -and (-not $bestVersion -or $v -gt $bestVersion)) {
        $best = $c
        $bestVersion = $v
      }
    }
    $best
  }

  function Select-Runtime {
    if ($env:HOUSE_RULES_RUNTIME) {
      $rt = $env:HOUSE_RULES_RUNTIME
      $min = if ([IO.Path]::GetFileNameWithoutExtension($rt) -like 'bun*') { [version]'1.4.0' } else { [version]'22.0.0' }
      $v = Get-RuntimeVersion $rt
      if (-not $v -or $v -lt $min) {
        $shown = if ($v) { "$v" } else { 'no version' }
        Fail "HOUSE_RULES_RUNTIME=$rt reports '$shown', below $min"
      }
      return $rt
    }
    $rt = Select-Newest 'bun' ([version]'1.4.0')
    if (-not $rt) { $rt = Select-Newest 'node' ([version]'22.0.0') }
    if (-not $rt) {
      Fail 'needs Bun 1.4 or newer (https://bun.sh) or Node.js 22 or newer (https://nodejs.org)'
    }
    $rt
  }

  function Assert-Git([string]$Why) {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
      Fail "git is required to $Why (https://git-scm.com/download/win, or: winget install --id Git.Git -e)"
    }
  }

  # True when the two directories differ in any file name or content.
  function Compare-Tree([string]$A, [string]$B) {
    # .NET hashing: the Get-FileHash cmdlet is missing when the utility module is not loaded.
    function Get-Digest([string]$Root) {
      $sha = [System.Security.Cryptography.SHA256]::Create()
      Get-ChildItem -LiteralPath $Root -Recurse -File -Force | Sort-Object FullName | ForEach-Object {
        $hash = [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($_.FullName)))
        $_.FullName.Substring($Root.Length) + ' ' + $hash
      }
    }
    [bool](Compare-Object @(Get-Digest $A) @(Get-Digest $B))
  }

  # Shows paths under the home directory as ~\... for the instructions.
  function Show-Path([string]$Path) {
    $home_ = "$env:USERPROFILE\"
    if ($Path.StartsWith($home_, [StringComparison]::OrdinalIgnoreCase)) {
      return '~\' + $Path.Substring($home_.Length)
    }
    $Path
  }

  function Sync-Checkout([string]$Dir) {
    if (Test-Path -LiteralPath "$Dir\compose.mjs") {
      if (Test-Path -LiteralPath "$Dir\.git") {
        Assert-Git "update $Dir"
        if ((Invoke-Native 'git' @('-C', $Dir, 'pull', '--ff-only', '--quiet')) -ne 0) {
          Fail "could not fast-forward $Dir; update or move it by hand, then run this again"
        }
        Write-Host "Updated $(Show-Path $Dir)"
      } else {
        Write-Host "Using $(Show-Path $Dir) as it is (not a git checkout)"
      }
    } elseif ((Test-Path -LiteralPath $Dir) -and (Get-ChildItem -LiteralPath $Dir -Force | Select-Object -First 1)) {
      Fail "$Dir exists but holds no compose.mjs; set HOUSE_RULES_DIR to another path"
    } else {
      Assert-Git 'download house-rules'
      $repo = if ($env:HOUSE_RULES_REPO) { $env:HOUSE_RULES_REPO } else { 'https://github.com/bompus/house-rules.git' }
      if ((Invoke-Native 'git' @('clone', '--quiet', '--depth', '1', $repo, $Dir)) -ne 0) {
        Fail "could not download house-rules; check the network and HOUSE_RULES_REPO, then run this again"
      }
      Write-Host "Downloaded house-rules to $(Show-Path $Dir)"
    }
  }

  $rt = Select-Runtime
  if ($PrintRuntime) {
    Write-Output $rt
    return
  }
  Write-Host "Using $(Show-Path $rt) ($(Get-RuntimeVersion $rt))"

  $dir = "$env:LOCALAPPDATA\house-rules"
  if ($env:XDG_DATA_HOME) { $dir = "$env:XDG_DATA_HOME\house-rules" }
  if ($env:HOUSE_RULES_DIR) { $dir = $env:HOUSE_RULES_DIR }
  $cfg = "$env:USERPROFILE\.config\house-rules"
  if ($env:XDG_CONFIG_HOME) { $cfg = "$env:XDG_CONFIG_HOME\house-rules" }
  if ($env:HOUSE_RULES_CONFIG_DIR) { $cfg = $env:HOUSE_RULES_CONFIG_DIR }
  Sync-Checkout $dir

  New-Item -ItemType Directory -Force -Path $cfg | Out-Null
  if (-not (Test-Path -LiteralPath "$cfg\house-rules.json")) {
    Copy-Item -LiteralPath "$dir\examples\person\house-rules.json" -Destination "$cfg\house-rules.json"
    Write-Host "Created $(Show-Path "$cfg\house-rules.json") from the example"
  }

  # --skills-out must be new or empty, so compose beside the old directory and
  # keep the old one under another name instead of deleting it.
  $skills = "$cfg\composed-skills"
  # Unique per run: under iex, $PID is the caller's session and repeats on a retry.
  $next = "$skills.new-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
  $code = Invoke-Native $rt @("$dir\compose.mjs", '--config', "$cfg\house-rules.json", '--out', "$cfg\rules.md", '--skills-out', $next)
  if ($code -ne 0) {
    if (Test-Path -LiteralPath $next) {
      Fail "compose failed; see the error above ($(Show-Path $next) holds a partial result; delete it)"
    }
    Fail 'compose failed; see the error above'
  }
  if ((Test-Path -LiteralPath $skills) -and -not (Compare-Tree $skills $next)) {
    Remove-Item -LiteralPath $next -Recurse -Force
    Write-Host 'The skills are unchanged'
  } else {
    if (Test-Path -LiteralPath $skills) {
      # Move-Item into an existing directory would nest it, so never reuse a name.
      $stamp = "$skills.previous-$(Get-Date -Format 'yyyyMMddHHmmss')"
      $old = $stamp
      $n = 0
      while (Test-Path -LiteralPath $old) {
        $n++
        $old = "$stamp-$n"
      }
      Move-Item -LiteralPath $skills -Destination $old
      Write-Host "Kept the previous skills in $(Show-Path $old); remove it when you no longer need it"
    }
    Move-Item -LiteralPath $next -Destination $skills
  }

  $import = (Show-Path "$cfg\rules.md") -replace '\\', '/'
  Write-Host ''
  Write-Host "Composed $(Show-Path "$cfg\rules.md") and $(Show-Path $skills)."
  Write-Host 'Connect them to your agent:'
  Write-Host '  Claude Code: add this line to ~\.claude\CLAUDE.md'
  Write-Host "    @$import"
  Write-Host "  Other hosts: copy the contents of rules.md into the host's user-level"
  Write-Host "  rules file and put house-rules-references beside it. Point its"
  Write-Host "  skills directory at composed-skills."
  Write-Host 'To change modifiers or skills, run:'
  $q = { param([string]$Path) "'" + $Path.Replace("'", "''") + "'" }
  Write-Host "  & $(& $q $rt) $(& $q "$dir\compose.mjs") setup --config $(& $q "$cfg\house-rules.json")"
  Write-Host "  (or edit $(Show-Path "$cfg\house-rules.json")), then run this installer again."
}
