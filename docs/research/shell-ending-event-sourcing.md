# Shell endings: one channel, written at occurrence

Status: proposal. Drives the event-sourced shell-ending refactor.

## The defect being removed

A background-shell ending today has **two delivery channels**:

1. The durable event log, via a `background-shell-ended` event.
2. The `shell_kill` tool result, which returns the final snapshot and all output
   in-band.

The moment `shell_kill` was allowed to return the ending as its result, the same
fact had two channels, and every downstream consumer has had to reconcile them.
The accumulated machinery is all reconciliation over that single fork:

- `endingClaimed` — suppress the notice because the tool result already told.
- `outputClaimed` — the hollow notice that exists only to carry hook drafts.
- teardown's `recordEndings` — synthesize an ending for anything the log lacks.
- the `recorded` flag (PR #922) — mark the synthesized ending as bookkeeping so
  it does not render or wake.
- the legacy read-side filters in the transcript that hide duplicates already in
  old logs.

Each reconciler is a place the two channels can disagree, which is why the stale
"background shell ended / killed by atlas / printed nothing" notification was
fixed three times (#802, #825, #871, #922) and kept recurring. The bugs are not
in any one reconciler; they are the cost of the fork.

## The greenfield invariant

**If it is not in the log, it did not happen.**

One channel, written once, at occurrence:

1. **The event log is the only announcement channel.** The only way any shell
   ending reaches anyone — model, UI, teardown, recovery, rewind, a future
   surface — is as a `background-shell-ended` event in the durable log.

2. **Written at occurrence, not at drain.** The event is appended when the shell
   actually settles, not when a notice queue happens to drain. The log is
   literally complete at all times, so every question ("is this open? lost?
   already told?") is one pure scan of the log — what `lifecycleOf` already is.

3. **The notice queue is a wake-up bell, not a store.** It holds no event
   payload. It says only "there is a new event at seq N for thread T." If the
   process dies, nothing durable was pending in memory, so teardown has nothing
   to reconcile — `recordEndings` and the claim flags disappear.

4. **Reads are free.** `shell_kill`'s result and `shell_output` are reads of the
   same log-backed record, not deliveries. A read can happen twice or never;
   nothing downstream cares. "Did the model see this?" stops being a question
   the system must track.

5. **Recovery shrinks to one job.** A start with no end in the log means exactly
   one thing — the process died mid-write — because nothing else can produce
   that state. No distinguishing "unrecorded" from "delivered another way."

## Why this does not regress when features are added

The robustness is structural, not procedural. New kill reasons, new lifecycle
states, services, sub-agent endings, teammates all inherit the guarantee for
free, because there is no per-feature reconciliation code to update. The current
design fails the opposite way: each new ending path must remember to claim,
mark, dedup, and reconcile, and forgetting any one produces a ghost
notification.

This is the same conviction PR #919 applied to message intake — one
prepare → append → acknowledge seam — pushed one layer earlier, to occurrence.
It makes intake's acknowledge step trivial: the event already exists; there is
nothing to acknowledge.

## What `shell_kill` becomes

`shell_kill` still waits for the death and still returns `snapshot + output` —
a synchronous tool cannot not return. But the result is explicitly a **read**:
"here is what happened." The announcement the model acts on arrives through the
same `background-shell-ended` event every other ending uses.

The one display concern this raises: the model could see the kill twice — once
as the tool result, once as the ending event in the same turn. That is a
**presentation** suppression at assembly ("this turn already answered a
shell_kill for this shellId, so the ending event is not re-rendered to the
model"), not a delivery guarantee. If the suppression misfires, the cost is one
redundant line, not a lost or duplicated record. The record is always written
exactly once.

## What gets deleted

- `endingClaimed`, `outputClaimed`, the hollow hook-ride notice.
- teardown's `recordEndings` synthesis and `unresolvedEndings` reconciliation.
- the `recorded` flag on `background-shell-ended` (PR #922) — it was the right
  patch on the old shape; the old shape is the problem.
- `ShellRecovery`'s need to guess whether a missing end was a crash or a claim.

## What stays

- `lifecycleOf` / `lostShellsOf` / `endedShellKeysOf` — the pure pairing over
  the log is already the correct read model; it becomes the only one.
- After-shell hooks — but their drafts append alongside the occurrence write,
  not by riding a notice (see ordering below).
- The read-side legacy filters from #922 — as the migration layer for pre-change
  logs. Old sessions keep their duplicates hidden; new sessions never write them.

## The hard part: occurrence-time write ordering

Writing at occurrence is the whole design, and it has one real constraint: an
ending's full output is known only after the process is reaped and its buffers
drained, and after-shell hooks must run before the event carries their drafts.

So "at occurrence" means: the ending event is appended from the shell's settle
path (`startBackgroundShell`'s `settled` continuation), after output drain and
after `afterShellDrafts` resolve — not from a queue drain later. The append is
the thing that makes the ending real; the queue is then notified that seq N
exists, purely to wake whoever is listening.

Failure mode this removes: today a crash between settle and drain loses the
ending entirely (it lived only in memory), and a crash between drain-compute and
append duplicates it. With the write at occurrence, a crash before the append
leaves a start with no end — which recovery correctly reads as "died
mid-write," the only state recovery ever needs to handle.

## Non-goals

- No change to how endings are displayed beyond the suppression noted above.
- No migration of old logs; the read-side filters remain.
- Services and sub-agent endings stay on their current channels in this pass;
  the refactor proves the pattern on shells, and the same shape can lift to them
  once it holds.
