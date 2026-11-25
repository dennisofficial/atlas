# Handoff pause — shared contract

This is what is left of the v1 lift/descend redesign after the v1 deletion (2026-11-25). The DAG
runner, the lift and descend plans, the attach seam and the session archive were v1 only and are
gone. What stays is the pause seam: v2 uses it when a host drains and hands a session to another
host. Dennis's directions that this still encodes:
- **Pause, don't interrupt.** Loops halt at a resumable seam (before the LLM request), the session
  moves, then the loops resume on the new host. The model never sees a broken or aborted turn.
- **Everything moves.** The parent thread and every sub-agent and teammate pause together.

## 1. The pause mechanism

### PauseSignal

A handoff pause is not an `AbortSignal`. Abort means cancel and discard (it sets `killedBy`). Pause
means freeze at the seam, keep the record clean, and expect to resume.

`packages/agent/src/loop/pause-signal.ts`:

```ts
export class PauseSignal {
  get paused(): boolean
  pause(): void
  resume(): void
  waitIfPaused(): Promise<void>
  onPause(listener: () => void): () => void
}
```

`pause()` and `resume()` are idempotent. `onPause` lets a waiting call react at once.

### TurnOutcome has a handoff-paused arm

`ETurnStatus.Paused` means "awaiting approval", so the handoff has its own member:
`ETurnStatus.HandoffPaused = 'relocation-paused'` with the arm `{ status: HandoffPaused; runId }`
(`packages/agent/src/loop/turn-outcome.ts`). The stored string keeps `relocation` on purpose. The
loop writes no drafts for this outcome: the record is already complete at the seam.

### The seam in the loop

`trackedTurn`'s `for (;;)` (`packages/agent/src/loop/tracked-turn.ts`) checks `pause.paused` at the
top of each iteration, before the drain and the model step, and returns `HandoffPaused`. Every
draft of the previous steps is already appended, so the record is the whole state and a resume
enters the turn again from the record.

The pause also reaches into a step that is already running:
- `throwIfPaused` (`packages/agent/src/loop/retry-ledger.ts`) throws `HandoffAborted` from the
  retry backoff, and `run-turn.ts` maps it to the paused outcome.
- `settle-pending.ts` stops settling pending calls and detaches the ones that can detach.

`runTurn`, `resume` and `say` (`packages/agent/src/loop/run-turn.ts`, `turn-runner.port.ts`) take an
optional `pause?: PauseSignal` next to `signal?: AbortSignal`. The two are independent: abort still
means a real interrupt.

### Host drain

`HeldSession` (`packages/host/src/holder/held-session.ts`) owns one `PauseSignal` for its turns
(`held-turns.ts`). `beginDrain()` pauses it, marks the record as draining, and aborts only a call
that waits on the workspace gate.

### Per-child pause

Each child run (`packages/host/src/holder/crew/child-run.ts`) owns its own `PauseSignal` and passes
it to its turns. `ChildRun.pause()` pauses without `killedBy`, waits for the child to settle within
the drain cap, and aborts it only after the cap. `CrewRoom.pauseAll()`
(`packages/host/src/holder/crew/crew-room.ts`) pauses every running child, sub-agents and teammates
alike, and the drain calls it through `childrenPause`.

## 2. What does not change

- The session record is the single source of truth. One owning writer at a time. A resume starts
  from the record (`docs/core-contract.md`).
- The pause never writes `interrupted` drafts and never sets `killedBy`. Only abort does.
- A handoff survives a host drain, a SIGKILL and a pod restart, and the work runs exactly once
  (`describeHandoff` scenarios in `apps/api/src/agent/__tests__/faults/`).
