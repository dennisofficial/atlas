# Durable shells

Shell output, input, and exit status belong to a process supervisor, not the terminal attachment.
The harness shells module owns conversation events, watches, read cursors, and reconciliation.

## Ownership

Each background command has one detached supervisor. It spawns the Bash process, owns stdin,
redirects stdout and stderr directly into one append-only file, waits for the child's actual exit,
writes its terminal status atomically, then exits. It does not wait for Atlas to acknowledge that
status. Closing an Atlas attachment does not close the child's pipes or lose its exit code.

The supervisor has no model, event-log writer, hooks, or power assertion. Caffeinate remains tied
to Atlas's lifetime. Unclaimed work has a supervisor-owned timeout; storage has no independent
reaper. This is restart and crash insurance, not a background-agent product tier.

## Storage

Shells live beside their owner's event log inside the existing session:

```text
sessions/<session>/
  threads/
    <thread>.events.jsonl
    <thread>.meta.json
    <thread>/
      shells/<unique-shell-id>/
        spool.out
        config.json
        meta.json
        status.json
        cursor
        control.sock
        control.token
        leases/
```

The existing session registry resolves the session root for main agents, sub-agents, and
teammates. Shells do not derive a new session from a child's id. Existing event and metadata
files remain in place; the added thread directory holds auxiliary data, not another event log.

Each command gets `ATLAS_SESSION_DIR` and `ATLAS_THREAD_DIR` for its own thread. A background
shell also gets `ATLAS_SHELL_DIR`. These are per-invocation values, never process-global mutable
state shared by concurrent agents. This change does not replace `TMPDIR`; session-owned temp
policy is separate work.

## Two records of different facts

The spool contains raw process bytes. The conversation event log contains structured facts
Atlas observed and told the model. Exit status comes from the supervisor's child wait, not from
parsing output. A stopped output file alone never proves a command exited.

All shell conversation events pass through one per-shell serialized journal. A start precedes
progress; an ending is terminal. Wakes reference successfully persisted events and contain no
second copy of output to append at turn drain. Rewind disowns and quiesces the journal before
truncating history. Failed terminal writes remain retryable without admitting late progress.

Read cursors use byte offsets in the append-only spool. Excerpts carry their source range; they
are not claims that the excerpt is the entire file. The model gets the output path at start and
completion and can use Read or Grep for history instead of repeatedly draining a shell tool.
File notifications trigger delta reads; reconciliation on attachment and termination, plus a
fallback check, keeps missed or coalesced notifications from losing output or completion.

Still-running check-ins are removed. Historical check-in events still decode and render.
Matched notices describe a point-in-time match, never assert that a command is currently alive.

## Input and control

The supervisor keeps the child's stdin pipe open. An authenticated local control connection
accepts input, explicit EOF, and termination. Reconnecting Atlas can use the same interface.
This is not a pseudo-terminal: terminal-only prompts and full-screen interactive programs are
not supported. Closing stdin is permanent for that command.

Live adoption requires the expected supervisor identity and authenticated control handshake;
a PID by itself is never authority to adopt or kill. A supervisor lost before reaping its child
cannot provide the child's later exit code. Recovery reports that limitation rather than
inventing a successful exit.

## Lifecycle

Normal local exit detaches shells. The quit guard offers keeping shells, explicitly stopping
tasks, or staying. Agents and services still stop on local exit. Restart follows the same
attachment lifecycle. Detaching does not append an ending or pretend the command completed.

Reopening inspects durable shell status. A live shell reconnects with its original identity and
read cursor. A command that completed while Atlas was absent produces an ending with its real
exit status. Events always go to the owning thread, never the currently visible conversation.

Execution-location moves and confirmed rewind remain destructive controls. They stop the
moving or removed shells before changing location or cutting their history. Live processes
cannot transfer between host, Docker, and cloud. Session archives can carry completed output
and terminal status, but never grant control through an imported PID or socket token.

## Limits

The default kernel file-size limit is 5 GiB. The output file does not rotate or truncate, so
stored offsets remain meaningful. `RLIMIT_FSIZE` applies to each regular file the command and
its descendants write, including build artifacts and database files; it is not a total disk
quota and does not bound pipes or sockets. A handled size-limit failure is not necessarily a
process death, and an arbitrary nonzero exit code is not proof of output overflow.

Explicit command deadlines and existing silence policy belong to the supervisor so a vanished
Atlas attachment cannot disable them. No still-running cadence wakes the model.

## Prior art

The March 2026 source snapshot at `https://github.com/codeaashu/claude-code` redirects both
output descriptors directly into a per-task file and tells the model that path. Its TaskOutput
tool is deprecated in favor of Read. It does not adopt commands after a CLI crash, persist their
exit status independently, or support reconnectable stdin. Its startup-cleanup incident is the
reason not to sweep another live session's output files.
