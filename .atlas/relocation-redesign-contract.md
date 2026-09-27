# Relocation redesign — shared contract

This is the single source of truth for the lift/descend revamp. Every builder works against these
interfaces. If a slice discovers the contract is wrong, STOP and report — do not improvise a divergent
shape. Dennis's directions that this encodes:

- **Everything moves.** Parent, subagents, teammates — one session, one archive, one commit point.
- **Pause, don't interrupt.** Loops halt at a resumable seam (pre-LLM-request), transfer, then resume
  on the far side. The model never sees a broken/aborted turn.
- **As much concurrency as correctness allows.** A DAG; the one hard edge is that the session archive
  is taken only after every writer is paused.
- **Single commit point, two-phase failure.** Before `flipOwnership`: abort-safe, GC orphans, stay put.
  After: ownership moved; recovery is re-attach or the reverse move. Never a half-state, never lost data.
- **Dedicated attach seam.** Attaching to a lifted session is not "open a local conversation."
- **Mount:** drive at `/atlas`, `/atlas/workspace` + `/atlas/home`. Unchanged.

## 1. The pause mechanism

### PauseSignal

A relocation pause is NOT an AbortSignal. Abort = cancel and discard (writes `interrupted:true`
drafts, sets `killedBy`). Pause = freeze at the seam, keep the log clean, expect to resume.

```ts
// packages/harness/src/loop/pause-signal.ts
export class PauseSignal {
  get paused(): boolean
  pause(): void            // idempotent
  resume(): void           // releases waiters; idempotent
  waitIfPaused(): Promise<void>  // resolves immediately unless paused
}
```

### TurnOutcome gains a relocation-paused arm

`ETurnStatus.Paused` is taken (awaiting approval). Add a new wire enum member, e.g.
`ETurnStatus.RelocationPaused`, and a TurnOutcome arm `{ status: RelocationPaused; runId }`. The
loop returns it when it halts at the seam for a relocation pause. It writes NO drafts — the log is
already complete at the seam.

### The seam in the loop

In `trackedTurn`'s `for(;;)` (run-turn.ts), at the top of each iteration BEFORE `takeModelStepWithRetry`
fires (i.e. right before the LLM request, after drain/assemble of the previous step): if a pause is
requested, halt and return `RelocationPaused`. All drafts from prior steps are already appended
(run-turn.ts:419), so the log is the whole state — resume re-enters `runTurn` from the log.

`runTurn`/`resume`/`say` accept an optional `pause?: PauseSignal` alongside `signal?: AbortSignal`.
When present, the seam check runs each iteration. The two signals are independent: abort still means
abort (used by real interrupts), pause means freeze-for-relocation.

### Per-child pause

Each child carries `child.abort = new AbortController()`. Add `child.pause = new PauseSignal()`,
created in `ChildSteps.take` and passed to the child's step (`runner.resume({ threadId, signal, pause })`).
`stopChild({ child, by })` stays abort. A new `pauseChild({ child })` calls `child.pause.pause()`
without touching `killedBy` — a paused child is NOT stopped, NOT terminal, and resumes cleanly.

`stopThreadChildren` (relocate-children.ts) currently aborts children for a lift. The lift DAG
instead calls a new `pauseThreadChildren` that pauses every stepping child (subagents AND teammates —
`skipTeammates` is gone for relocation; everything moves) and awaits their `RelocationPaused`.

### Remote pause (descend)

Pausing loops inside the sandbox rides the channel. `RemoteDeltaChannel` gains `pause()` /
`resume()` siblings to `interrupt()`, and the wire gains a pause frame. Serve's loop honors it at the
same seam. `RemoteTurnRunner` threads the pause through (it already maps its `signal` abort to
`channel.interrupt()` at remote-turn-runner.ts:96-102).

## 2. The DAG runner

Pure, in harness (no I/O of its own — node effects are injected async thunks). Testable with plain data.

```ts
// packages/harness/src/cloud/relocation/dag.ts
export type RelocationNode<Ctx> = {
  id: string
  needs: readonly string[]          // node ids that must complete first
  run: (ctx: Ctx) => Promise<void>  // the effect; injected, does the real work
  /** True for the single commit node. See commit semantics below. */
  commit?: boolean
}

export type RelocationPlan<Ctx> = readonly RelocationNode<Ctx>[]

export type RelocationRun =
  | { ok: true }
  | { ok: false; phase: 'pre-commit'; failed: string; error: unknown }   // abort-safe: GC + stay put
  | { ok: false; phase: 'committed'; failed: string; error: unknown }     // moved: re-attach/reverse

export async function runRelocation<Ctx>(args: {
  plan: RelocationPlan<Ctx>
  ctx: Ctx
  onStep?: (id: string) => void
}): Promise<RelocationRun>
```

Semantics:
- A node is runnable when all its `needs` have completed. The runner fires the ready set concurrently
  (`Promise.all` over ready nodes), advancing as each settles.
- The `commit` node must have every non-commit node in its ancestor set (directly or transitively)
  before it runs — it is the barrier. After it, only post-commit nodes run.
- A failure in a node whose completion the commit node depends on → `phase:'pre-commit'`. A failure
  in the commit node itself is pre-commit (ownership not yet flipped) UNLESS the node's own effect
  flipped ownership before throwing — so the commit node is written to flip LAST, after its confirms.
- A failure after the commit node completed → `phase:'committed'`.
- Cycle or unknown `needs` id → throw at plan validation, before anything runs.

## 3. The lift plan (node/edge table)

```
captureWorkspace   needs: []                          (git diff, durable workspace)
captureGpg         needs: []
captureContext     needs: []                          (skills/memory tar)
claim              needs: [captureWorkspace]          (control-plane row + token; needs workspace spec)
provision          needs: [claim, captureContext]     (drive + sandbox boot + serve launch; SLOW)
pauseLoops         needs: []                          (pause parent + ALL children at seam; no quiescence needed to START, runs concurrent with provision)
archiveSession     needs: [pauseLoops]                (tar the session folder — ONLY after all writers paused)
shipSession        needs: [archiveSession, provision] (upload transcript onto the row; serve must be up)
confirmLanded      needs: [shipSession]               (anti-blank-log gate: serve reports session present+non-empty)
flipOwnership      needs: [confirmLanded]  commit:true (local store → Cloud; point of no return)
attach             needs: [flipOwnership]             (attachCloudSession — bind UI to channel+remote stores)
resumePaused       needs: [attach]                    (resume each paused loop + relocation notice per log)
```

The concurrency win: `provision` (seconds of container boot) runs the whole time `pauseLoops` +
`archiveSession` are settling. Today they're strictly serial.

## 4. The descend plan (mirror)

```
pauseRemoteLoops   needs: []        (channel.pause() → serve pauses its loops at the seam)
archiveRemote      needs: [pauseRemoteLoops]
shipDown           needs: [archiveRemote]   (channel carries the archive home; overwrite local session dir)
confirmLocal       needs: [shipDown]        (local session dir present + non-empty)
flipHome           needs: [confirmLocal]  commit:true   (local store → Host)
mergeWorkspace     needs: [flipHome]        (EXISTING uncommitted-patch merge, conflict markers — keep)
reopenLocal        needs: [mergeWorkspace]  (real openConversation — local open, adopts/locks/recovers)
resumePaused       needs: [reopenLocal]
destroySandbox     needs: [flipHome]        (GC the cloud sandbox + row; warn-not-fail on error)
```

## 5. The attach seam

```ts
// packages/harness/src/cloud/relocation/attach-cloud.ts
// (or apps/tui/src/composition/cloud/attach-cloud.ts if it stays a TUI surface concern — decide at
//  integration; the READ-STORE binding is harness, the App rebuild is TUI)
```

`attachCloudSession({ channel, stores, registries })` binds the UI to a lifted session WITHOUT going
through `openConversation`. It reads the transcript window/spend/base from the remote (read-only)
stores and produces the `OpenedConversation`-equivalent the UI mounts. It never adopts, never claims
a local lock, never settles lost shells/agents — those are local-ownership behaviors. This REPLACES
the `openConversation(readOnly:true)` patch (which gets reverted).

## 5b. Whole-folder transfer is a guarantee, not an accident

`archiveSession` tars the ENTIRE session directory (`sessions/<id>/`, recursively) — every file and
subdir a feature puts there moves with the session. The ONLY exclusion is the `lock` file (it names
the local process; meaningless remotely). There is no whitelist of file types and never will be: a
future feature that stores state under the session folder must ride the move with zero relocation
changes. Do not introduce a selective/pick-list archive. Descend untars the same folder wholesale.

## 6. What does NOT change

- Mount layout `/atlas/workspace` + `/atlas/home`.
- The descend workspace merge (merge-published.ts) — conflict markers, superseded detection. Keep.
- `relocateSession` for the local Docker/Host moves — untouched; this redesign is cloud lift/descend.
- Session folder layout (`sessions/<id>/threads/<thread>.events.jsonl`) — already correct.
- Core contract: transcript is the single record, one owning writer at a time, resume-from-log.

## 7. TDD seams (pre-agreed)

- `runRelocation` (dag.ts): concurrency order, commit-point split, pre-commit abort, committed failure,
  cycle/unknown-need validation. Pure — no sandbox.
- Pause seam in the loop: a turn pauses at the seam with a clean log (no `interrupted` drafts),
  returns `RelocationPaused`, and resumes from the log to completion.
- `pauseChild`/`pauseThreadChildren`: stepping children pause without `killedBy` and resume.
- `attachCloudSession`: binds without adopt/lock/recovery writes (the refusing-stores regression).
- Lift plan on the DAG: full lift against fake bridge; assert provision overlaps pause (timing or
  call-order), commit gate holds, failure before/after commit lands the right phase.
- Descend plan on the DAG: mirror assertions; workspace merge preserved.
