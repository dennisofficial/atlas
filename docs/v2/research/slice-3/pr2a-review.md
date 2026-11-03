# Slice 3 PR 2a review findings (draft PR #1736)

Independent review of `dennis/v2-daemon` (3 commits on `d5e153bb5`), 2026-11-03, plus one finding
from the session's own read. Anchors are in that branch. Every item must be fixed, with a
conformance test that fails before the fix, before #1736 leaves draft. v1 was checked unchanged:
the old harness execution paths are re-export stubs, the moved specs are byte-identical, and the
daemon priority branch is gated on `ATLAS_SANDBOX_WORKLOADS === '1'`, which nothing in v1 sets.

## Bugs

| #   | Where                                                                             | Defect                                                                                                                                                                                                                                   | Fix                                                                                                  |
| --- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | `apps/daemon/src/calls/ledger.ts:84-127,140-147`                                  | `stepCalls` is called but its effects and refusals are ignored. Two concurrent runs of one key both spawn; a run that awaited I/O across an epoch takeover still starts; `ack` of a running call deletes it, so a later run spawns again | Serialize per key before any await; let `stepCalls` effects decide spawn, journal and delete         |
| 2   | `packages/protocol/src/frames.ts:74-83`, `subscription.ts:24-26`, `server.ts:134` | File ops return strings, arrays and objects, but the result schema is `{ exitCode, output?, error? }`; casts hide it, and the conformance client casts instead of parsing (`apps/daemon/src/testing.ts:127-129`)                         | Per-op result schemas; conformance parses every frame with `daemonFrameSchema`                       |
| 3   | `ledger.ts:215-221,230-251`, `server.ts:245-247`                                  | A failing op (ENOENT, EACCES, bad executable, bad cwd) leaves the journal `running` forever, sends no result, and raises an unhandled rejection                                                                                          | Every failure becomes a durable terminal result; transport handler errors are contained              |
| 4   | `apps/daemon/src/process/managed.ts:32-49,149-152`                                | Without cgroups, cancel kills only the parent; `sh -c 'sleep 30 & wait'` leaves the child alive, and inherited pipes delay the result                                                                                                    | Own process group plus a group kill with escalation; test that descendants die                       |
| 5   | `frames.ts:30-37`, `server.ts:129,159-162`                                        | No frame carries a resume offset; the server always replays from 0, and a repeated run on the same socket replays again over a live stream                                                                                               | `run` (or a reattach frame) carries `fromOffset`; fault F3                                           |
| 6   | `managed.ts:101-105,121-124`                                                      | stdout and stderr allocate offsets before their appends complete, so disk order can differ from offset order                                                                                                                             | One append queue for both streams: offset, persist, notify, in order                                 |
| 7   | `apps/daemon/src/subscription.ts:17-26,39-45`                                     | `result` can be sent before the replayed output; an overlapping chunk is dropped whole instead of trimmed                                                                                                                                | Terminal frame waits for replay and buffer drain; trim by byte range                                 |
| 8   | `ledger.ts:254-270`                                                               | `settle` marks the call done before the done journal is fsynced; a duplicate run or ack can race it                                                                                                                                      | Persist, then publish, under the per-key lock                                                        |
| 9   | `apps/daemon/src/ops/exec/index.ts:32-38`                                         | stdin stays open, so `cat` hangs until timeout                                                                                                                                                                                           | Close stdin for exec                                                                                 |
| 10  | `apps/daemon/src/ops/files/grep.ts:10-18`                                         | `--max-count 1` returns one match per file; rg spawns raw, unboxed and uncancellable                                                                                                                                                     | Drop the per-file cap; run rg through `ManagedProcess`                                               |
| 11  | `apps/daemon/src/index.ts:13-14`                                                  | A missing `V2_DAEMON_SECRET` or sandbox name becomes `''`, so the token is publicly computable                                                                                                                                           | Refuse to start without them                                                                         |
| 12  | `packages/protocol/src/testing/fake-daemon.ts:93-97,138-180`                      | The fake accepts `run` before hello, and after a takeover during a running call the new holder never gets the result                                                                                                                     | Model authenticated connections and transferable subscriptions; both cases in shared conformance     |
| 13  | `apps/daemon/src/calls/restore.ts:29-31,58-65`                                    | A journal found `running` is deleted and respawned with no boot or read-only check. Normal startup prunes first, so this is reached only through races or tests without boot, but it is an unguarded double run                          | Never respawn; a non-done journal outside boot is an internal error. The host decides reruns (row 5) |

## Spec deviations

- **Boot protection is off by default** (`apps/daemon/src/boot.ts:8-10`): the daemon applies cgroups
  and `oom_score_adj` only if the environment already says so. The daemon must establish its own
  policy at startup, on every boot, and report failure (spec point 10).
- **Hello does not enforce the highest epoch ever seen** (`server.ts:80-94,249-251`): after epoch 7
  disconnects, an epoch-5 hello succeeds. The ledger still refuses its calls; the hello must too.
- **The host must not "just send run" after a changed `bootId`.** An unknown key spawns at once, so
  the host compares `bootId` and applies `recoverCall` row 5 before it sends anything (PR 3).

## Parallel-build seams: not yet clean

Handlers cannot publish events or see connection lifecycle (`apps/daemon/src/ops/registry.ts:9-24`),
the fake's ops are one central file (`fake-ops.ts:19,75`), and the result contract is exec-only. Before
feature builders start, each of these must become per-group so a group touches only its folder plus
one registration line:
- `apps/daemon/src/ops/index.ts`, `packages/protocol/src/ops/index.ts`, `.../testing/conformance/suite.ts`:
  registration lines (fine).
- `fake-ops.ts`, `fake-daemon.ts`, `ops/registry.ts`, `server.ts`, `frames.ts` result schema: must gain
  an event-publish capability, connection lifecycle hooks, per-group fake ops and per-op results.
  `ManagedProcess` is genuinely key-independent; keep it.

## Conformance gaps

Duplicate runs are sequential, not concurrent; the offset test never reconnects; `decodeChunks`
discards duplicates; the client's `until` reuses old frames; "boot prune" uses a fresh home instead
of restarting on the same disk. Missing: concurrent run, takeover during pending I/O, takeover during
a running call (real and fake), zombie ack on a stored result, mixed-stream ordering, replay/exit
race, op-error settlement, schema validation of every frame, descendant death on cancel, and the
gated `ATLAS_LIVE_SANDBOX=1` cgroup and OOM cases.

## Nits

`packages/wire/src/boot-progress-wire.ts` grows to 308 lines; positional multi-argument functions in
`ledger.ts:57`, `restore.ts:22`, `server.ts:56`, `subscription.ts:11`; string unions instead of
E-enums (`journal.ts:8`); `packages/sandbox` depends on `atlas-wire` (the task said no in-repo deps);
the spawn-count file hook (`index.ts:19-28`) is live in the production bundle when its env is set.
