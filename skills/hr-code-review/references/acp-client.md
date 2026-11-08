# ACP review client

Use the bundled `../scripts/acp-panel-client.mjs` when the selected review needs
an ACP v1 agent over stdio. This helper does not choose a provider, model,
effort or review scope. It does not select a route based on whether it uses the usage
allowance. Launch it only within the user's authorization.

```sh
bun <skill-directory>/scripts/acp-panel-client.mjs \
  '["<agent-command>","<stdio-argument>"]' brief.md answer.txt <review-root> \
  --model <advertised-model-id> --effort <advertised-effort-value> \
  --verdict 'VERDICT:' --max-turns 2 --idle-min 5 --timeout-min 60 --no-web
```

Node 22+ and Bun can run the same file. It imports `seat-launch.mjs` from the same
directory (the seat's environment, agent detection and the Codex and Devin
setup), so a copy needs both files. Arguments after the output path are
optional. The default is one turn, no required verdict, five minutes of idle
silence counted from launch and a sixty-minute hard deadline. The hard deadline has a one-minute
minimum.

## Flags

| Flag                              | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--model ID`, `--effort LEVEL`    | Bind the model and effort before the first prompt, through the agent's `model` and `effort`, `reasoning_effort`, `thought_level` or `thinking_level` option. The value must be advertised, and the agent's echo must match: the model may differ only in case, `_` for `-`, or a `provider/` prefix on one side only (two different prefixes are refused), the effort exactly. A missing option, a missing or wrong echo, or a later setting that undoes an earlier one stops the run before the prompt. A seat that names no `--model` keeps the model its launch arguments chose and is not checked. |
| `--verdict MARK`                  | The text that completes the answer. `--max-turns N` allows that many prompts, each after the first asking for the answer ending in the marker.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `--idle-min N`, `--timeout-min N` | Idle silence counted from launch and the hard deadline.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `--no-web`                        | Keep the seat off the network: see below. Exit 5 when a network-capable tool call completes without having been refused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `--allow-reads`                   | Allow permission requests for `read` and `think` tool kinds, and for `search` and `fetch` unless `--no-web` is also given. Without it every request is refused.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `--policy MODULE`                 | Run the caller's launch policy first: see below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `--policy-option KEY[=VALUE]`     | Repeatable. Passed to the policy as `options`, every value a string (the string `"true"` when no value is given, not a boolean).                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

The client refuses a flag it does not know, a flag without its value and extra
positional arguments with exit 2 and the usage line, before any launch, so a
caller that passes a restriction this version lacks is stopped instead of run
unrestricted. A value that starts with `--` is not a value: `--policy-option
--no-web` is refused, not read as an option named `--no-web`.

## Launch policy

A host's own limits (for example per-model effort ceilings) live in the caller's
module, not in this client. The module exports `check`, or a default function of
the same shape:

```js
export function check({ model, effort, command, options }) {
  // model, effort: the --model and --effort values ("" when not given)
  // command: the parsed server command array
  // options: { key: "value" } from the --policy-option flags
  // throw an Error to refuse the launch; the return value is ignored
}
```

`check` may be async. A refusal, a module that does not load and a module
without a function all exit 2 with `[client] FATAL: launch policy <path>: <message>`
before any server starts. A TypeScript module needs Bun.

## Capabilities and permissions

The client advertises confined file reads, disables writes and terminal
execution, and refuses permission requests. Physical file targets must stay
inside the canonical review root. Put Git/GitHub evidence in the brief when the
agent cannot obtain it through its own approved route.

- **Permission requests.** Every request is refused unless `--allow-reads` is
  given. With it, only `read`, `think` and (without `--no-web`) `search` and `fetch`
  requests are allowed; shell (`execute`), edit, delete, move, MCP (`other`) and
  requests with no kind are refused, and so is every request from Codex.
- **Mode.** Codex (by its launch, or by a reported agent name or title containing `codex`) must advertise and confirm `read-only`. Any other agent is set
  to `read-only` when it offers that mode. Claude's adapter has no `read-only`
  mode: when it starts in `auto`, `acceptEdits` or `bypassPermissions` (modes that
  can approve an edit without asking) and offers `default`, it is set to `default`
  and must echo it; Devin's `accept-edits`, `smart` and `bypass` are moved to `ask` the same way. When the agent offers none of `read-only`, `default` or `ask`, the run is
  refused. Any other start mode is kept.
- **Claude's adapter** starts with `Read`, `Grep` and `Glob` as its only built-in
  tools (plus `WebFetch` and `WebSearch` only with `--allow-reads` and without
  `--no-web`) and ignores the user's MCP servers.
- **Devin** starts with a config that denies its shell and every MCP operation,
  and under `--no-web` also fetches, web search and subagents. It is built from
  the config Devin would have read (the launch's `--config PATH` or
  `--config=PATH`, resolved against the review root, else the user config with
  its hooks and rules; comments in it are read under Bun only), written to a
  private directory and removed at exit, also when the client is stopped by
  SIGTERM, SIGINT or SIGHUP (it then exits 128 plus the signal number). In every
  mode its imports of other tools' settings (`read_config_from`: Claude, Cursor,
  OpenCode, Windsurf, Zed, VS Code, Copilot, the agents standard, cloud, and any
  source already listed) are switched off, because a checkout's `.mcp.json` or
  `.cursor/mcp.json` would start MCP servers with the session. The client
  refuses (exit 2): a launch that names `--config` twice; a config that cannot
  be read; any `.devin` folder in the review root or a parent up to the
  project root (a directory holding `.git` or `.jj`; with none, every parent
  below the home folder, whose `~/.devin` is Devin's own data), since project
  settings, MCP servers and hooks there run before the panel's rules apply; and,
  under `--no-web`, a Devin MCP server that is not disabled (in `mcp_config.json`
  beside the user config or the given config, or `mcpServers` in the config),
  because Devin starts those at launch and nothing switches them off per
  session, and an `mcp_config.json` the client cannot parse (comments in it need
  Bun) because its servers are then unknown. When a package runner starts Devin, `--config` goes right after the name it starts, and after an interpreter's Devin script. Devin's cloud mode (`--cloud`, `devin cloud`) is refused, because the session then runs on a remote agent that the local deny rules and the offline check do not reach. A launch that may start Devin but that the client cannot read is refused: an argument named `devin` after a runner option that takes a value (`npx --cache DIR devin`), or a Devin script beside another interpreter script (`node --import shared/preload.mjs devin/index.js`). Only the executable, a runner's package and an interpreter's scripts count, not other arguments such as a title. With several Devin scripts, `--config` goes after the last plain one.
- **Codex** (recognized from the launch command: its executable, package,
  script, or a launch it cannot read that could still start `codex-acp` by the same rule as Devin's (the executable, a runner's package, an interpreter's scripts); an agent that only names itself Codex after
  `initialize` still gets read-only mode, but no wrapper) always runs through a wrapper that turns off every MCP server
  `codex mcp list --json` names (listed from the review root, so the checkout's own
  project servers are included) (a seat never needs one, and a server runs with the
  user's own configuration); under `--no-web` the wrapper also turns off web
  search and the apps connector. The client refuses (exit 2) when that list cannot
  be read (`CODEX_PATH`, or `codex` on `PATH`, must run it), when a server name
  cannot be turned off safely, and on Windows, where it cannot start a Codex seat
  at all. `CODEX_CONFIG` (JSON the caller sets for codex-acp) passes through
  without its `mcp_servers` table, which codex-acp would add to the session
  without `codex mcp list` showing it; invalid JSON in it refuses the launch. The wrapper reaches Codex through `CODEX_PATH`, which codex-acp honors; an adapter that starts Codex another way is not covered.

## Environment

The seat starts with a narrowed environment, not the caller's: named locale,
path, XDG, proxy and certificate variables (on Windows, also the variables a
program needs to start), plus only the variables its own agent reads to log in
(`CODEX_` and `OPENAI_` for Codex, `ANTHROPIC_` and `CLAUDE_` for Claude, `DEVIN_`,
`GROK_` and `XAI_`, `GEMINI_` and `GOOGLE_` for Antigravity, `CURSOR_`).

A Claude
seat on Bedrock keeps `AWS_` and one on Vertex keeps its Google credential path
and region, when `CLAUDE_CODE_USE_BEDROCK` or `CLAUDE_CODE_USE_VERTEX` is on.

The
agent is read from the launch executable, the package a `bunx` or `npx` runner
starts (or its `--package=` argument), or the script an interpreter runs (a
script files (or a path ending in an adapter's own name without an extension, such as `tools/bin/codex-acp`) named on the command line, matched on the nearest of their last four
path segments (the file's own name counts without its extension: `devin.mjs`), never a home directory, and only when they all name the same agent:

a flag's value, attached (`--import=PATH`) or separate, that looks like a script makes the launch ambiguous, and so
does a package runner option that takes a separate value, as in `npx --cache DIR
PACKAGE`, a runner given more than one `--package=`, or a runner whose `--package=` names another agent than the command it runs (`npx --package=<claude> codex-acp`); an ambiguous launch gets the named variables only), never from other
arguments. Other vendors' keys, `GH_TOKEN` and `SSH_AUTH_SOCK` stay
out, and an agent the client does not recognize gets the named variables only.

`ACP_PANEL_PASS_ENV`, set by the caller as comma-separated prefixes, adds more
(for a custom agent's login variables, or a test's fake agent). The caller also
owns temporary-storage policy: set `TMPDIR` for the client and the seat inherits
it, for example when `bunx` unpacks an adapter on a RAM-backed `/tmp`.

`HOME` and `XDG_RUNTIME_DIR` stay in the environment, because agents read their
login files and runtime sockets from them. That has two consequences. Credential
files under `HOME` can be read by the agent's own read tool. And a socket under
`XDG_RUNTIME_DIR` (for example an agent socket at its conventional path) is
reachable by anything the seat can run, even though `SSH_AUTH_SOCK` is withheld.

Files inside the review root are readable by the seat, `.git/config` included:
keep no credential there (a remote URL with a token, for example).

This narrows what a seat can pick up from its environment, shell and MCP tools.
It does not sandbox the agent. Outside a sandbox (a process namespace and a
filesystem view the caller builds, as a review service can) the allowlist and the
refused permission requests are the only guards: a seat whose agent runs a shell
without asking is covered only by its environment. Run a review that matters
inside a sandbox.

The client runs `git status` in the review root with the same narrowed
environment (plus the variables that point git at a repository) and with
`core.fsmonitor` switched off on the command line, because the repository's own
configuration can name programs git runs. A seat that writes git configuration
there (a clean filter, for example) can still get a command run, with that
narrowed environment; the status comparison does not see the file because
`.git` is not part of the listing.

## OpenCode

OpenCode is not an ACP agent. `../scripts/opencode-seat.mjs <model-id> <effort>
<prompt-file> [title] [--root CHECKOUT] [--bwrap PATH]` runs `opencode run --standalone` in the current
directory with an empty environment (`PATH`, `HOME`, `TMPDIR`, `LANG` and the
XDG directories). Permissions deny every tool except read, glob and list (no
grep: its rules match search patterns, not files), keep `.env` files unreadable
(`.env.example` stays readable) and refuse reads outside the directory; they are
set globally and on a dedicated agent because OpenCode applies agent permissions
after global ones.

Read patterns the user's own global OpenCode config (`opencode.json` and `opencode.jsonc`, both read) denies or
asks about stay denied, placed after every rule of the seat's own because the last
matching rule decides, and a default or whole-tool deny or ask there (`permission: "deny"`, `{"*": "deny"}`, or for read alone)
becomes a final deny-all (a config this runtime cannot parse is ignored;
comments in it need Bun). Project configuration and Claude Code compatibility are
off, and the prompt is an attached file. It writes OpenCode's JSON events to
stdout and passes its exit status through; a stop sent to it goes on to OpenCode,
with a forced kill after 5 seconds.

On Linux it also runs OpenCode under bubblewrap (`bwrap` must be installed; the
seat exits 127 without it), because OpenCode treats a whole git project as inside
and follows symlinks. The seat sees only the system folders (read-only), the
name-resolution, public TLS (`/etc/ssl/certs` and the like, never `/etc/ssl/private`) and loader files under `/etc`, an empty home, a private
`/tmp`, a sanitized copy of the checkout, the prompt file and the OpenCode binary itself.
The original checkout is never mounted.

Before the sandbox starts, the seat copies the checkout into a private folder (mode 0700, under
`TMPDIR`) and shows it read-only at the checkout's own path, where the seat starts. The copy
holds regular files only. Symlinks, special files and every `.git` entry are not copied, so a link
cannot lead out of the checkout and the seat has no git history or `.git/config`. Empty folders keep their place; files are copied, never
hard-linked, and the folder is removed when the seat ends, including after a stop sent to it.

The copy leaves out each `.env` file (`*.env` and `*.env.*`, not `*.env.example`) and each file the
user's own denied read patterns match by name, by path from the checkout or by absolute path (a leading `~` or `$HOME` in a pattern is the home folder, as in OpenCode;
`*` and `**` match any run of characters, `?` one). It also leaves out the file a denied-named link
(`.env -> secret.txt`) points to when that file is inside the checkout, and the files a link to a
directory (`secrets -> backing`, nested links included) would name as denied
(`secrets/token.json`), where they really are. Every other name of a left-out file (a hard link, found by device and
inode) is left out too.

A denied file inside a `.git` folder (its object store excepted), such as the `config` that may carry a remote URL token, is left out under every name, and a `.git` that is a link is followed. A folder reached by two paths is checked under each; a link back to a folder above it is refused when a denied pattern names a path.

A prompt file the rules deny, under the name given or as the file it resolves to (a link to an outside `.env`), refuses the run (exit 2), and so does a prompt that is not a regular file (a folder would put more than the task in view). A prompt inside the checkout is the copy's own file; one outside it is copied into the copy under a `.panel-seat-prompt-` name, so no outside path is mounted.

Bubblewrap is found in a system folder (`/usr/bin`, `/bin`, `/usr/local/bin`, `/run/current-system/sw/bin`) or at the absolute path given as `--bwrap PATH` after the other arguments, never on `PATH` and never from an environment variable: a checkout's own tooling is often first on `PATH`, Bun reads the checkout's `.env` into the environment, and this helper runs before any boundary. The outside prompt is read once from a verified descriptor (no link followed, a regular file, not a denied name).

Launch the script from a folder you trust and name the checkout with `--root CHECKOUT` (default: the launch folder, with a warning on stderr). Bun reads `.env` and `bunfig.toml` from the launch folder before the script starts: a checkout's `.env` can set `HOME`, `XDG_CONFIG_HOME` or `TMPDIR` where the real environment has none (moving the denial config the wrapper reads), and a `preload` in its `bunfig.toml` runs code before any boundary. The temporary folder that holds the copy must lie outside the checkout (exit 2 otherwise). A file hard-linked from outside the checkout under a name no rule denies is copied. A denied `*` copies only the prompt file, when it is inside the checkout.

A checkout with more than 200000 entries, 100000 files or 512 MiB of copied files is refused (exit
2), and so is one that changes while it is copied (a file replaced or resized, a folder swapped for a link), and so is a review root that is or contains the home folder or OpenCode's config or data folder, because the sandbox shows the root over its empty home. OpenCode's config folder
is hidden, so the key for the model's provider (the id before `/`) is read from
OpenCode's auth file and passed as `OPENCODE_API_KEY`; the seat's own process can
read that back through `/proc`. Only the `opencode-go` and `opencode` providers take their key that way; a model of another provider (which needs its own variable or an OAuth record) is refused with exit 2.

A layout that relies on links inside the checkout loses them in the copy. On other systems there is no copy and no filesystem boundary
beyond OpenCode's own rules.

## What the client holds

A seat's stderr passes through with each line prefixed `[seat] `, and control
characters in any seat-supplied text (tool titles, ids, names) are written as
`\xNN`, so a seat cannot start a line of its own such as `[client] FATAL: ...`.
The client stops the run with exit 1 when one server message exceeds 16 MiB, the
collected answer exceeds 32 MiB, or the seat starts more than 100000 tool calls,
also when that happens after the last reply. A stopped client (SIGTERM, SIGINT,
SIGHUP) stops the server, killing it after 5 seconds if it ignores SIGTERM, and
exits 128 plus the signal number; helper processes the server started may
outlive it.

A server that exits while a helper still holds its pipes ends the run
after one second.
Once the answer is written the client reads nothing more from the server, so
output after that point neither grows memory nor changes the outcome. Tool-call
ids and kinds are kept short in memory (a long id is replaced by its hash).
The answer is written to a new file in the same directory that is then renamed over the physical path the output argument names at launch (an existing file keeps its permissions) (so a name the seat made a hard link to another file is replaced, never truncated),
refusing a final component that has become a symlink (checked with `O_NOFOLLOW`
where the system has it, and before opening everywhere) and a directory that is
no longer the one resolved then.

## Limits

These controls govern client-provided ACP capabilities and the launch
environment. They do not sandbox an agent's own tools, prevent dishonest setting
reports, or eliminate filesystem races during concurrent replacement. The caller
must qualify the provider's own read-only route. Git status comparison detects
some workspace changes; it does not detect ignored-file writes or prove that no
writes occurred. The comparison is per path and lists each untracked file. It
leaves out untracked files under `skills/system/` in the launch directory, which
a seat's runtime (Codex) writes by itself at session start, so a seat's own new
file there goes undetected; a tracked change there, or a file that was there at
launch and is gone at the end, still counts.

The output contains collected agent text. Exit codes are:

- 0: satisfied verdict condition
- 1: setup/protocol failure, including a server that exits or cannot start
- 2: missing or unknown arguments, a launch policy refusal, or a refused `--no-web` or Devin setup
- 3: incomplete verdict
- 4: changed Git status, with the changed paths in the log (the answer file is written after this comparison)
- 5: under `--no-web`, a tool call that can use the network completed without having been refused (exit 4 takes precedence); a call the agent types or titles as a web search (`Web search`, `Search the web`) counts whatever kind it reports. A call the client refused is not counted, because adapters report a refused call as completed with a denial; an adapter that runs a call after the client refused it is not detected, so `--no-web` relies on the tools being removed (Claude), turned off (Codex) or denied (Devin), and exit 5 catches calls that ran without asking
- 124: deadline, even when the agent honors the cancel

A permission-cancelled turn may continue within `--max-turns`. A matching marker
is a completion signal, not proof that the review is accurate. Fatal errors
print `[client] FATAL: <message>` on stderr.
