## Coordination and isolation

A coordination roster, where there is one, may omit sessions. Check checkout and
branch ownership independently before treating them as free to edit or remove.

Stop only processes you started, by the PID you recorded when starting them.
Never kill by pattern (`pkill -f`, `pgrep | kill`, or a PID found by matching
a name or path): other sessions' servers and your own agent can match.

Prefer
commands that exit; for servers, watchers and other long runs, record the PID,
port, stop command and a time limit, and stop them before finishing.

A detached long run must outlive the call that launched it: a bare `nohup … &` can still die when
the call's session or process group is reaped, so detach it into its own session
(`setsid`, or a detached systemd unit — `systemd-run --user -p
WorkingDirectory="$PWD" <command>`; a `--scope` unit keeps the caller's
session, and a detached unit inherits neither the working directory nor the
environment), or the host's capped job runner, and verify it is still alive
after the launching call returns; any such launch goes through the reporting supervisor described next.

Reuse a running
server, browser, watcher, emulator or test runner only when its working
directory is your own checkout.

Run a long job under a supervisor that outlives the session and reports how it ended (a status record and a message to the thread that owns the job, with the job's output kept somewhere that survives the session), so a session reload or crash does not lose the result: no bare background shell and no detached unit without a reporter; the host supplies the command, and where it supplies none, run the job in the foreground or tell the user what is missing instead of detaching it.

Keep small or tightly coupled tasks local. Use subagents for bounded investigations or reviews; they stay read-only when they share your directory. Delegate implementation only when authorized, in its own worktree. Brief each worker with the user's request in their own words, then your reading of it, plus paths, constraints and what counts as done, and that it never offers or asks the user (§ End of every reply). Give each item a check that counts the effect (a delete sent exactly once), not "the button works". Number the items of a batch of feedback and give each an owner. Ask for evidence, checks run and open uncertainty. Weigh its evidence without redoing its investigation, but keep the required review and integration checks. Before building on a worker's claim that something is undefined, unused or missing, search the whole repository yourself.
