param([Parameter(Mandatory=$true)][string]$OutputPath,[Parameter(Mandatory=$true)][string]$StopPath)
$ErrorActionPreference='Stop'
$cpuCounter=New-Object System.Diagnostics.PerformanceCounter('Processor','% Processor Time','_Total')
$memoryCounter=New-Object System.Diagnostics.PerformanceCounter('Memory','Available MBytes')
$pageCounter=New-Object System.Diagnostics.PerformanceCounter('Memory','Pages Input/sec')
$records=@()
try {
  [void]$cpuCounter.NextValue()
  for($i=0;$i -lt 120;$i++) {
    $items=@(); $missing=0
    foreach($p in Get-Process) {
      try { if($null -ne $p.CPU) { $items+=@{pid=$p.Id;name=$p.ProcessName;cpuSeconds=$p.CPU;started=$p.StartTime.ToUniversalTime().ToString('o')} } } catch { $missing++ }
    }
    $self=Get-Process -Id $PID
    $records+=@{utc=[DateTime]::UtcNow.ToString('o');totalCpuPercent=$cpuCounter.NextValue();availableBytes=$memoryCounter.NextValue()*1MB;pagesInputPerSec=$pageCounter.NextValue();processes=$items;missingProcesses=$missing;observerCpuSeconds=$self.CPU;observerWorkingSet=$self.WorkingSet64}
    if(Test-Path $StopPath) { break }
    [Threading.Thread]::Sleep(1000)
  }
  ConvertTo-Json -InputObject $records -Depth 5 -Compress | Set-Content -LiteralPath $OutputPath -Encoding utf8
} finally { $cpuCounter.Dispose();$memoryCounter.Dispose();$pageCounter.Dispose() }
