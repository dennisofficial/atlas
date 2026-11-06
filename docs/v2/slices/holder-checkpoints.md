# Slice spec: holder checkpoints (architecture §12 L3)

Status: **spec, 2026-11-06.** Follows #1956 (the holder loads visible events plus bookkeeping).
Applies [architecture.md](../architecture.md) §12 L3 and L4 to the agent host. Anchors are
`path:line` at `4edd3a5f8`; re-check before relying on one.

## Goal

A step on a long thread costs the same as a step on a fresh one. Every per-step decision the loop
and the holder make (pending calls, whose turn it is, resume, worktree, workspace, once-ledger,
branches) reads a checkpoint advanced by each append, or the tail since a known seq. Nothing
re-folds or re-maps the loaded log per step. History edits (rewind, summary, loop cut) are the only
events allowed to rebuild, because they are rare and change what is visible.

Out of scope: persisting checkpoints in the control plane (slice 4 views do that for clients; the
holder rebuilds its checkpoint at takeover from the load it already does), assembly itself (L4,
bounded by summaries since #1956), the v1 loop (`packages/agent-v1`, `harness`), which keeps its
own folds.

## Why, measured

A 20k-event in-memory cache (user, call, result, reply in rotation; no summary), p50 of 7 runs:

| Work                                | Cost    |
| ----------------------------------- | ------- |
| `RecordCache.visibleLoopEvents()`   | 16.4 ms |
| `resumeDrafts` over the loop events | 7.6 ms  |
| `RecordCache.resolvedAll()`         | 6.4 ms  |
| `pendingCalls` over the loop events | 5.0 ms  |
| `awaitsReply`, `projectDirectoryOf` | ~1 ms   |

One loop iteration calls `composedEvents` up to five times and `modelContext.read` twice
(`packages/agent/src/loop/tracked-turn.ts:62,67,80,113,176,180,191`), each a full
`visibleLoopEvents()` in the holder, and then folds the result again. That is roughly 100–150 ms of
CPU and several 20k-element arrays per step, per session, on a host that holds many sessions. It is
small next to a model call, so this slice is about host density and headroom, not latency the
operator feels today.

## What exists today

Loop (`packages/agent`, v2 only; `harness` uses `agent-v1`):
- `AgentRecordPort` exposes `ownEvents({ afterSeq? })` and `composedEvents()`
  (`packages/agent/src/record/agent-record.port.ts:12-14`); `ModelContextPort.read` returns the
  assembly input.
- Whole-log reads per step: `tracked-turn.ts` (above), `settle-pending.ts:76,89` (then
  `pendingCalls`, `activeWorktreeOf`, `homeDirectoryOf` at `:79,83,84`), `resume-turn.ts:19`,
  `close-quiet-step.ts:33`, `shell-completion.ts:12`, `dispatch-recovery.ts:35`.
- Folds over them, all in `core`: `pendingCalls` (`events/projections.ts:31`), `crashedCalls`
  (`:85`), `outstandingApproval`, `awaitsReply` (`:142`), `resumePlan` / `resumeDrafts` /
  `isResumable` (`events/resume-plan.ts:40-69`), `activeWorktreeOf` / `homeDirectoryOf` /
  `projectDirectoryOf` (`workspace/worktree.ts:24,59,94`). Tail-only folds that still receive the
  whole log: `messageArrivedSince`, `committedSinceLastMessage`
  (`packages/agent/src/loop/turn-position.ts:14,27`), `unansweredTail`
  (`core/src/events/unanswered-tail.ts`), `shellCompletionNudge`
  (`core/src/events/shell-completion-nudge.ts`), `loopCutPlan` (`core/src/events/loop-cut.ts:163`),
  `unsettledCall` (`packages/agent/src/loop/swallowed-outcome.ts`).

Holder (`packages/host/src/holder`):
- `RecordCache` (`record/record-cache.ts`) keeps the loaded events and folds visibility on
  `extend` (`:138`), but `visibleLoopEvents()` (`:130`) re-maps every event per call,
  `findDispatched` (`:162`) scans backwards, `all()` / `resolvedAll()` (`:122,126`) are handed out
  whole.
- Scans of the whole cache: `V2OnceLedger` lookups and recalls (`record/v2-once-ledger.ts:81,104,112,121`),
  `ackRecordedDaemonResults` (`record/record-commit.ts:38`, once per open), `workspaceStateOf` /
  `activeFailure` / `isResumable` (`held-idle.ts:43,53,81,189`, `held-snapshot.ts` via
  `held-session.ts:193`), `isWorkspacePrepared` (`held-wait.ts:25`), `branchesChanged`
  (`core/src/record/branches.ts:51`, via `held-runner.ts:100`).

## Approach

Three PRs, each green on its own.

### PR 1: incremental cache (host only)

In `RecordCache`:
- Keep `loopEvents: Event[]`, the mapped visible loop events, appended in `extend` for each event
  that is visible and maps (`toLoopEvent`). `visibleLoopEvents()` returns it (readonly, no copy).
- Keep `indexBySeq` (events are seq-ordered: binary search on `seq`) so
  `loopEventsAfter(seq)` and `committedHashAtSeq` are O(log n + k). `SessionRecord.ownEvents({ afterSeq })`
  (`record/record-adapter.ts:100`) uses it instead of filtering.
- Keep maps advanced in `extend`: `dispatched: Map<callId, { bootId }>` (cleared per callId on
  `tool-called`, matching `dispatchedCalls`), `facts: Map<key, value>`, `retries: Map<key, ScheduledRetry>`
  in append order, `branches: Map<repo, observation>`, `prepared: boolean`, `lastPrepareFailure`,
  `lastUserSaidSeq`. `V2OnceLedger`, `findDispatched`, `ackRecordedDaemonResults`, `held-*` and the
  branch observer read these instead of `all()` / `resolvedAll()`. Prefix recalls
  (`recall`, `recallRetries`) iterate the map, which holds only facts and retries.
- **History edits rebuild.** When `extend` sees `history-rewound` or `history-summarised`, it
  rebuilds `loopEvents` from `events` after stepping visibility (one O(n) pass per edit, as
  `refillIfRevealed` already accepts). The maps are visibility-independent except `branches` and
  `prepared`, which follow the current fold rules: check each against its `core` function in the
  property test below and rebuild them on edits too if they differ.
- Remove `all()`, `resolvedAll()` and `loopEvents()` from the public surface once no caller is
  left, so a new whole-cache scan cannot creep back in.

### PR 2: `LoopState` in core

New pure module `packages/core/src/record/loop-state.ts`:

```ts
export type LoopState = {
  pending: readonly PendingCall[]
  dispatched: ReadonlySet<CallId>
  approvals: ReadonlyMap<CallId, number>
  lastTurnType: EventType | undefined
  lastAssistant: { seq: number; interrupted: boolean } | undefined
  lastUserSaidSeq: number | undefined
  worktree: ActiveWorktree | undefined
  home: string
}
export const initialLoopState: (args: { launchDirectory: string }) => LoopState
export const stepLoopState: (state: LoopState, event: Event) => LoopState
```

plus derivations that take a `LoopState` and return what the existing folds return:
`pendingCallsOf`, `crashedCallsOf`, `awaitsReplyOf`, `outstandingApprovalOf`, `projectDirectoryOfState`
and `resumePlanOf` (`cutShortSincePrompt` needs only events after `lastUserSaidSeq`, so it takes
that tail as a second argument).

`pending` must keep positional matching: a result settles the latest open call with its id
(`projections.ts:26-30`, kimi's per-request ids).

**Oracle test (the gate for this PR):** a property test in `core/src/record/__tests__/` generates
random event sequences (calls, results, denials, dispatches, approvals, user and assistant turns,
worktree moves, repeated call ids) and asserts every derivation equals the existing fold on the
same events, after every prefix. The existing folds stay as the reference.

### PR 3: the loop reads state and tails

- `AgentRecordPort` gains `loopState({ threadId }): Promise<LoopState>`. `InMemoryAgentRecord`
  computes it by folding its events (it is the reference); `SessionRecord` returns the cache's
  checkpoint, stepped in `extend` and rebuilt on history edits like `loopEvents`. Child threads
  (`rowsOwnedBy`) fold only owned rows, as today.
- Call sites switch: `settle-pending.ts:76-84` uses `pendingCallsOf` / `worktree` / `home` and
  reads `composedEvents` only to hand `events` to tool dispatch where a tool needs them;
  `tracked-turn.ts:62,67,80-114` use `loopState` for interrupted, project directory, settle and
  `awaitsReply`; `resume-turn.ts`, `dispatch-recovery.ts` and `held-idle.ts:53` use
  `resumePlanOf` / `crashedCallsOf`.
- Tail folds take `ownEvents({ afterSeq })`: `messageArrivedSince` and `shellCompletionNudge` from
  `seenThrough`, `committedSinceLastMessage` and `unansweredTail` from `lastUserSaidSeq` /
  `lastAssistant.seq`, `loopCutPlan` and the loop watch from the start of the current turn.
- `modelContext.read` stays as is (assembly input), now an O(1) return from PR 1.

## Validation

- PR 1: existing host suite (run per file, `timeout 150 bun test <file>` in `packages/host`, as
  the whole suite outlives a 10-minute shell); a property spec in
  `packages/host/src/holder/record/__tests__/` that appends random batches with rewinds and
  summaries and asserts every incremental view equals a fresh `RecordCache.load` of the same log.
- PR 2: the oracle property test above; `bun test src/record` in `packages/core`.
- PR 3: `packages/agent` and `packages/host` suites; a scale spec in
  `packages/host/src/holder/record/__tests__/` that times one simulated step's state reads at 1k
  and 20k events and asserts the 20k cost is within 2× (or 5 ms) of the 1k cost, the same bound
  `packages/control/__tests__/postgres-scale.spec.ts` uses.
- Typecheck: `bunx turbo run typecheck --filter @dltech/atlas-core --filter @dltech/atlas-agent --filter @dltech/atlas-host --filter @dltech/atlas-agent-host`.
