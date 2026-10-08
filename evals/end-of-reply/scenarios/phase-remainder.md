---
expect: continue
---
## Project AGENTS.md
# sample-project
Run focused checks before landing. Use the approved repository landing path.

## Transcript so far
USER: Implement the configuration fix, run the checks, land it and verify the installed configuration.
AGENT: TOOL_CALL edit configuration and add a regression test
TOOL RESULT: All required checks pass.
AGENT: TOOL_CALL commit and land the fix
TOOL RESULT: Remote main contains the commit. The checkout is clean.
NOTE (durable task plan): Implementation, checks and source landing are complete. Installed configuration verification is authorized, pending and can run now. No decision, write lock or external dependency blocks it.
USER: Did the pull request land?
