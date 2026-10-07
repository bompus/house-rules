# Transcript inputs

The agent running the retrospective can use any model provider. Input support
depends on the application's recording format and the evidence it preserves.
Select one session per file and pass files explicitly. The parser does not
discover stores, open databases or export sessions for you.

## Supported formats

- Claude Code JSONL with message tool-use and tool-result blocks.
- Codex JSONL with session context, function/custom tool calls and their results.
- OpenCode JSON exports containing `info` and `messages` with `info`/`parts`.
  Export a selected session with `opencode export <session-id>` into task scratch.
  Tool parts preserve their native input, output/error and start/end timestamps.
  Sanitized exports can remove paths and commands needed for attribution.
- Cursor CLI `--print --output-format stream-json` recordings. Read/write calls
  and named function calls are supported. Use complete assistant messages;
  `--stream-partial-output` can duplicate text and is outside this adapter's
  coverage. Cursor's final-result JSON and text output omit tool events.
- ACP v1 `session/update` JSONL recordings. Each record can be a JSON-RPC
  notification, a `{sessionId, update}` envelope or a direct update object.
  Calls and incremental updates are merged by session and tool-call ID, with
  one call and one terminal result. This supports agents recording ACP v1,
  including Grok recordings with this shape, regardless of model provider.

OpenCode and ACP tool names are normalized for read, grep, glob, list, shell,
write and edit operations. ACP can also supply a tool kind and file locations.
An unfamiliar tool remains in the total count; its navigation activity may be
unclassified. ACP display titles are not treated as tool names or shell commands.
Protocol v2, native Cursor databases, Devin databases and Antigravity protobuf
stores are outside the native adapters' verified coverage.

## Missing evidence

The parser uses recorded ISO timestamps or numeric Unix seconds/milliseconds.
ACP itself does not supply timestamps. A recorder can add a top-level
`timestamp`; Cursor recordings can provide `timestamp_ms`. The parser does not
invent timestamps from file modification times or the time of analysis.

All selected events are analyzed by default. `--since-days` excludes events
without usable timestamps and reports undated tool calls on stderr. A file with
no supported tool calls also produces a warning; an empty report does not prove
the session had no navigation failures. Inspect warnings alongside metric JSON.

Use `--cwd <absolute-recorded-session-directory>` when a recording omits its
working directory. Recorded context takes precedence over this fallback. ACP
session-new/load/resume requests can provide cwd when included in the recording.
Repository-root mappings label paths; they do not establish a session's cwd.
Unmapped or unavailable directories remain unknown.

Missing-path checks inspect complete result diagnostics and known shell-result
JSON envelopes. Fenced examples and arbitrary source JSON are excluded. Unfenced
source text identical to a diagnostic remains ambiguous; verify the recorded
command and output before calling it a failure.

Missing result text, terminal references and unsupported tool fields are gaps
in evidence. They do not establish that a search found nothing. Synthetic tests
verify these adapters' metric behavior; time or token savings are unmeasured.

## Format references

- [OpenCode export command](https://opencode.ai/docs/cli/#export).
- [OpenCode SDK tool and message types](https://github.com/anomalyco/opencode/blob/dev/packages/sdk/js/src/gen/types.gen.ts).
- [Cursor CLI output format](https://cursor.com/docs/cli/reference/output-format).
- [ACP v1 tool calls and updates](https://agentclientprotocol.com/protocol/v1/tool-calls).

These external references describe input contracts, not installed agent guidance.
