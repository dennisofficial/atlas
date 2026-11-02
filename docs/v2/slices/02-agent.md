# Slice 2 spec: the `agent` package

Status: **approved 2026-11-02, built.** Two `AgentOutput` variants are deferred: the chunk filter and `waitState` stay callbacks, because moving them onto the port would add an event and change v1 timing. Sibling to [roadmap.md](../roadmap.md) slice 2. Applies
[architecture.md](../architecture.md) §7 and §12 L4, and [0019](../../decisions/0019-v2-package-map.md).
Evidence (read at `5203552d4`): the per-kind branch census, the intake census and the loop-seam
census summarized below; anchors are `packages/harness/src/…` unless stated.

## Goal

The loop every agent runs lives in `packages/agent` (`@dltech/atlas-agent`). Main agents,
sub-agents and teammates construct it the same way and differ only in the configuration passed in.
`harness` imports it and re-exports what it used to export, so v1 behaves exactly as before. The
loop runs in a test with no pod, lease, filesystem store or Bun API.

Out of scope: v2 events and the record ports' v2 adapters (slice 3), bounded reads and
materialized state (slice 3, §12 L1/L3), moving features into plugins (slice 7), changing any v1
behaviour, including the teammate/main wrapper differences that 0020 deletes later.

## What exists today

- **The model port already exists**: `ModelPort.step` in `packages/core/src/ports/model.port.ts:33-44`.
  The AI SDK adapter (`model/ai-sdk-model-port.ts`, `streamText` with `maxRetries: 0`) sits below it
  and stays in `harness`.
- **The loop is constructor-injected**: `LoopTurnRunner(TurnDeps)` (`loop/run-turn.ts:58-150`) needs
  no pod, lease or store class. `buildHarness` (`loop/build-harness.ts`) is v1's JSONL composition
  root and stays in `harness`.
- **One kind leak inside the loop**: `giveUpOf` (`loop/run-turn.ts:52-55`, used at `:152-180`)
  probes the model for a `switch()` method; only the child fallback wrapper
  (`composition/child-fallback-model.ts`) has one.
- **Kind branches outside the loop**: child tool deny lists (`agents/registry/child-runner.ts:63-73`),
  child model and fallback (`composition/child-model.ts`), six prompt fragments gated on
  `ctx.agent` (`prompt/fragments/{identity,agents,context-folder,grilling,memory,tools}.ts`),
  operator-input ancestry checks (`tools/builtin/operator-input.ts:52-63`,
  `operator-shell-input.ts:43-54`), and teammate hosting (spawn, report, relocation,
  subscriptions, GitHub tracking). Teammates are built by `buildChildRunner`, not `wireTurn`, so
  they skip the main-only turn-policy, titling and tl;dr wrappers (`composition/turn-wiring.ts:242-291`).
- **Package-edge traps** that would pull `harness` into `agent`: `logFieldsOf` is pure but lives in
  the filesystem module `store/logs.ts`; the `ApplyLoopCut` type lives beside log truncation in
  `store/sessions/ops/cut-loop.ts`; `ETurnStatus` comes through `@dltech/atlas-client/channel`
  from `packages/wire/src/turn-outcome-wire.ts:6`; retry normalization (`model/failure.ts`) imports
  `ai`, `@ai-sdk/provider` and credential error classes; `process.cwd()` defaults at
  `loop/run-turn.ts:146` and `loop/settle-pending.ts:78`.
- **One read serves two jobs.** Every iteration reads the whole composed log
  (`loop/tracked-turn.ts:75,80,90,122,181`; also `settle-pending.ts:71,85`,
  `close-quiet-step.ts:33`, `resume-turn.ts:18`, `shell-completion.ts:16`,
  `dispatch-recovery.ts:34`) and uses the same `events` both to decide (pending calls, own head,
  awaits-reply, guards) and to assemble the model's context (`tracked-turn.ts:194-200`).
- **Tests**: 48 loop specs; most run the real loop over a temp JSONL home via `buildHarness`. None
  runs the full loop without a filesystem.
- **Size**: `loop/` is 2,461 lines; the candidate move set is about 4,000.

## The package

`packages/agent`, workspace package `@dltech/atlas-agent`. Exports `.` and `./testing`
(in-memory record, scripted model, fake tools; never imported by production code). Dependencies:
`@dltech/atlas-core`, `@dltech/atlas-wire` (the browser-safe `./web` subpath only, for
`ETurnStatus`/`TurnOutcome`; see point 6), `zod`. No `ai`, no `@ai-sdk/*`, no `node:*`, no Bun API.

**Moves to `agent`** (harness keeps a re-export at the old path so no v1 import changes):

| From `packages/harness/src/`                                                                                                                                  | Notes                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `loop/*` except `build-harness.ts`, `tldr-turn-runner.ts`                                                                                                     | The turn runner, tracked turn, retries, settle, guard, watchdog, recovery                        |
| `intake/message-intake.ts`, `input-batch.ts`, `retained-source.ts`, `wait-for-input.ts`                                                                       | `MessageIntake` becomes generic over its submitted type (point 3); `sources.ts` stays (adapters) |
| `tools/dispatch.ts`, `dispatch-drafts.ts`, `hook-silence.ts`, `tool-result-draft.ts`, `registry.ts`                                                           | Dispatcher contract and the hooked dispatcher; tool implementations stay                         |
| `hooks/registry.ts`, `hooks/budget.ts`                                                                                                                        | `HookChain`; every hook implementation stays                                                     |
| `model/turn-fault.ts`, `errors.ts`, `admission-blocked.ts`, `cause-chain.ts`, `safe-failure-message.ts`                                                       | Pure fault vocabulary                                                                            |
| `logFieldsOf` out of `store/logs.ts`; `ApplyLoopCut`/`LoopCut` types out of `cut-loop.ts`; the `TurnSpendTally` contract out of `ledger/record-turn-spend.ts` | Types and pure helpers only; the JSONL log, the truncating cut and the ledger stay               |

**Stays in `harness`**: `buildHarness`, the AI SDK model port and provider adapters,
`model/failure.ts` normalization (injected, point 5), `quality/*` (the quality stage enters the
dispatcher through its existing port), the tl;dr, titling, turn-policy, publishing and activity
wrappers, pending queues, intake source adapters, every tool and hook implementation, the JSONL
store. The builder adjusts this list where an import closure forces it, and records why in the PR.

## Points to agree (the seams first, then the rest)

### 1. The configuration: one constructor for every kind

`LoopTurnRunner(TurnDeps)` stays the one constructor; `TurnDeps` is the agent's configuration.
Nothing in `agent` reads an agent type, a spawner, a depth or a teammate flag. Each per-kind branch
goes here:

| Branch today                                                                                                         | Slice 2                                                                                                                                                                         | v2 destination                                   |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `giveUpOf` probes `model.switch()` (`run-turn.ts:52-55`)                                                             | **Config**: `retry.failover?: () => boolean`, passed by `buildChildRunner`; the probe is deleted                                                                                | Same config                                      |
| Child tool deny lists, `toolRegistryFor`                                                                             | Unchanged; already config (the host passes a filtered registry)                                                                                                                 | Config                                           |
| Child model selection and fallback wrapper                                                                           | Unchanged; already config (a `ModelPort` is passed in)                                                                                                                          | Config                                           |
| Six fragments gated on `ctx.agent === Main` (identity, delegation, context folder, grilling, memory, operator input) | **Config**: `PromptContext.agent` is replaced by a set of enabled fragment groups the host chooses; main and teammate pass all six, sub-agents none. Same prompts byte for byte | Config (prompt fragments)                        |
| `subAgentPrompt` prepends the type's prompt                                                                          | Unchanged; already config                                                                                                                                                       | Config                                           |
| Operator-input tools check caller ancestry at invocation                                                             | Unchanged in v1 (tools, not loop)                                                                                                                                               | Config: the tool is granted or not               |
| Teammate skips turn-policy/titling/tl;dr; child progress observer                                                    | Unchanged (wrappers outside the runner)                                                                                                                                         | Policy config; teammates deleted                 |
| Spawn, report, roster, shell hold, relocation, subscriptions owner, checkout tracking, worktree claims               | Unchanged (outside the loop)                                                                                                                                                    | `pod` and plugins; teammate parts deleted (0020) |

### 2. The model port

`ModelPort` stays in `core`, unchanged. Retries stay in `agent`
(`takeModelStepWithRetry`), with failover explicit (point 1) and the clock injected:
`RetryDeps` gains `now?: () => number` beside the existing `sleep` and `jitter`, defaulting to
`Date.now` so v1 is unchanged.

### 3. The intake port: one seam the loop drains

The loop takes input only through `TurnDeps.intake: AgentIntake`:

```ts
export type AgentIntake = {
  prepare(args: { threadId: ThreadId; signal?: AbortSignal }): Promise<InputBatch>
}
export type InputBatch = {
  drafts: readonly EventDraft[]
  wakesTurn: boolean
  acknowledge(): void
  release?(): void
}
```

This is today's `drainPending` renamed, with the signal declared (it is already forwarded,
`loop/pending-intake.ts:21-34`). Reserve → append → acknowledge, release on abort or append
failure, stays exactly as it is. `MessageIntake<TSubmitted>` (the multiplexer of sources plus the
idle-wake scheduler) moves to `agent` and implements it; the operator queue's `SubmittedInput`
type stays in `harness` as the type argument. Every producer is an `IntakeSource`; the sources are
ordered shells → agents → services → plugins → operator, as today (`composition/intake-binding.ts:31-37`).

Today's paths and where each goes:

| Path today                                                                              | Slice 2                                                                                                                             | v2                                        |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Operator queue, shell/service/agent notices, plugin and subscription sources            | Already sources of `MessageIntake`                                                                                                  | Inbox entries consumed by the pod         |
| Child steering prepended to the batch (`child-runner.ts:116-138,200-217`)               | **Becomes an `IntakeSource`** that sorts first for that thread; the child-only drain recipe is deleted                              | Inbox (agent message)                     |
| `agent_say` to a running child without shared intake (`say.ts:90-96`)                   | Unchanged: production always wires intake (`container/register-agents.ts:105-108`), so this fallback only feeds the steering source | Deleted                                   |
| `say` / idle `agent_say` / spawn brief append directly, then run                        | Unchanged (they are outside the loop: commit, then start a turn)                                                                    | Inbox entry, then the pod wakes the agent |
| Teammate progress report, lost-child/service synthetic endings, serve history hydration | Unchanged (producer-side, outside `agent`)                                                                                          | Inbox or pod-logged events                |
| Hooks (before-turn/step/tool, after-turn), loop-guard and silent nudges, quality nudge  | Not input: phases of the loop or the dispatcher; unchanged                                                                          | Unchanged                                 |
| `operator_input` reply                                                                  | Not input: a correlated reply to an in-flight tool call; unchanged                                                                  | Pod tool port                             |
| Stop, pause, machine wake, model-wait                                                   | Not input: execution signals; unchanged                                                                                             | Inbox stop entry + direct hint (P7)       |

Agent-to-agent talk is an `IntakeSource` like any other; nothing in `agent` knows the producer.

**Steering and interrupts (unchanged in slice 2).** A message that arrives while the model is
streaming waits for the next boundary: the end of that model step, or the end of the running tool
batch. It is never spliced into a request in flight. A retry's backoff drains it into the retried
request. An interrupt is an `AbortSignal`, not input: the request stops, partial output is
recorded, and the outcome is `Interrupted`. Pause is the `PauseSignal`. In v2 the pod turns the
inbox stop entry and the direct hint (P7) into that same signal.

The intake port also exposes `subscribe(listener)` (already on every source and on
`MessageIntake`), so the loop can learn that waking input arrived mid-step. Slice 2 does not act on
it; superseding a thinking-only request (below) does.

### 4. The record ports: append, turn state, model context

The loop's one `EventLogPort` splits by what each read is for. v1 supplies all three from its
existing `EventLogPort` through one adapter in `harness`, so behaviour is unchanged.

```ts
export abstract class AgentRecordPort {
  abstract append(args: {
    threadId: ThreadId
    runId: RunId
    parentRunId?: RunId | undefined
    depth?: number | undefined
    drafts: readonly EventDraft[]
  }): Promise<Event[]>
  /** The thread's own events the loop decides from: pending calls, head, awaits-reply, guards. */
  abstract ownEvents(args: { threadId: ThreadId; afterSeq?: number }): Promise<Event[]>
}
export abstract class ModelContextPort {
  /** Everything assembly needs, in seq order. May omit history a summary covers. */
  abstract read(args: { threadId: ThreadId }): Promise<{ events: readonly Event[] }>
}
```

- Every call site is re-pointed by purpose: dispatch, recovery, guards, watchdog, new-input checks
  and resume read `ownEvents`; `prepareStepAssembly` (`tracked-turn.ts:183-200`) reads only
  `ModelContextPort`. In v1 `read` returns the full composed history, as today.
- **Slice 3 swaps without a second extraction:** the pod's `ModelContextPort` returns the latest
  `history-summarised`, the live `context-loaded` records and the uncompacted tail (L4), and the
  pod passes an assembly pipeline whose history rule reads that window. The loop does not change.
  The v1 `history-compacted` vs v2 `history-summarised` difference lives in that rule, not in the loop.
- `ownEvents` stays a whole-thread read in v1. Bounded state (`afterSeq`, L1/L3) is slice 3's;
  no scale machinery is added here.

### 5. Failure normalization is injected

`retrying-step.ts:21,204` and `model/run-failure.ts` call `normalizeProviderFailure`, which knows
SDK and credential error classes. `agent` takes it as `TurnDeps.normalizeFailure: (error) =>
NormalizedFailure` (the core type); `harness` passes the existing function. The pure classification
in `core/src/models/provider-failure.ts` is untouched.

### 6. Turn outcome vocabulary

`ETurnStatus` and `TurnOutcome` are imported from `@dltech/atlas-wire/web` (where the enum is
defined, `turn-outcome-wire.ts:6`), not from `atlas-client`. A copy in `agent` would be a second
enum TS refuses to assign. The `protocol` package (0019) is the later home.
**Alternative:** move the enum into `core` and have `wire` depend on `core`, which breaks `wire`'s
"no in-repo deps" rule. Not recommended.

### 7. Output is one typed port

Today the loop talks outward through scattered callbacks: `onChunk`, `onToolOutput`,
`retry.onWaiting`, `onContext`, `waitState`. They become one `AgentOutput` port with typed
variants: `chunk`, `tool-output`, `retrying { attempt, maxAttempts, reason, delayMs }`,
`waiting-for-model`, `context-size`. Failures stay durable typed events (`run-failed { failure }`,
with kind, scope and retryability), never chat text. `harness` adapts the port to today's
publisher, so v1 frames are unchanged. Rule: an error or retry is a typed variant end to end;
nothing renders it as a message, and nothing sends a message as an error.

### 8. Host effects are injected

`launchDirectory` becomes required (both `process.cwd()` defaults go; `buildHarness` and the two
composition roots pass it). Clock, ids, sleep and jitter are already ports or deps. A purity spec
in `agent` (like `core/src/__tests__/purity.spec.ts`) fails on any `node:*`, `bun`, `ai`,
`@ai-sdk/*` or `@dltech/atlas-harness`/`-client` import under `src/`.

## Seams under test (to agree before any test is written)

1. **The agent runner** (`LoopTurnRunner` from `@dltech/atlas-agent`), driven through its
   configuration with `./testing` adapters: in-memory `AgentRecordPort` + `ModelContextPort`,
   an in-memory `AgentIntake`, a scripted `ModelPort`, a fake tool registry. This is the exit seam.
2. **`MessageIntake`**: its existing specs move with it (prepare/ack/release, wake scheduling).
3. **The retrying step**: its existing no-store specs move (`retrying-step.spec.ts`,
   `give-up-consultation.spec.ts`, `stream-retry-cadence.spec.ts`, `upstream-http-retry.spec.ts`).
4. **The package boundary**: the purity spec (point 8).

The 40-odd JSONL-home loop specs stay in `harness` and keep passing unchanged; they are the
v1-no-change proof. Nothing tests `agent` internals.

## Exit tests (seam 1, no filesystem, no pod, no lease)

1. **Tool round trip**: input from intake → model calls a tool → `tool-dispatched` recorded before
   invocation → result appended → next step answers → `Completed`.
2. **Retry drains fresh input**: the first model call throws a transient fault; a message queued
   during the backoff reaches the retried request.
3. **Append failure releases**: the record refuses an append; the intake batch is released, not
   acknowledged.
4. **Same loop, different config**: two runners built from one recipe, one with a tool and a prompt
   group the other lacks; the model sees only its own declarations and prompt. No other difference.
5. **Explicit failover**: retries exhausted → `retry.failover` called once → the step succeeds on
   the switched model. Without `failover`, the turn fails as today.
6. **Context port is the only assembly input**: a `ModelContextPort` returning a window that omits
   covered history produces a request without it, while `ownEvents` still sees the pending call.

## Delivery

Three PRs, each green with v1 unchanged:
1. Scaffold `packages/agent`; move the pure leaves (fault vocabulary, `logFieldsOf`, loop-cut and
   spend types, `HookChain`, dispatcher contract and hooked dispatcher); harness re-exports.
2. Move the loop and `MessageIntake`; explicit failover; injected normalizer; record split; steering
   as a source; `launchDirectory` required.
3. Prompt fragment groups replace `ctx.agent`; `./testing` adapters; exit tests; purity spec; docs.

Docs updated in the last PR: roadmap Current state; [0020](../../decisions/0020-v2-sub-agent-worktrees-and-peer-sessions.md)
amended (its Context is stale: sub-agents already carry the worktree tools and are denied
`subscribe`; decision 3 is replaced by git-ref tracking, below); the slice 3 must-settle list gains
the two decisions below.

## Follow-up after slice 2: superseding a thinking-only request

When waking input arrives while the current model request has produced only reasoning (no text, no
tool call), the loop aborts the request with reason `superseded`, discards the partial reasoning,
and re-steps through the existing retry preparation (drain, reassemble), without spending retry
budget. Once text or a tool call has started, input waits for the boundary as today. At most N
supersedes per step (default 3), then input waits, so a burst of messages cannot starve the turn.
Hitting the cap emits a typed `supersede-limited` variant on `AgentOutput` (point 7); clients show
it as a toast, never as chat.
It changes v1 behaviour, so it lands as its own PR after slice 2, behind a setting, and v1 gets it
through the shared package.

## Decided this session, owned by later slices

- **A pod's disk is one session.** Pods are 1:1 with sessions, so a pod's home holds the session's
  files at its root, with no `sessions/<id>/` level (v1 nests one entry there, keyed by a thread id:
  `apps/serve/src/serve-boot.ts:213`). Threads keep their own subdirectory. Slice 3.
- **Branch and PR tracking reads git, not agents.** The pod reads `refs/heads` and `git worktree
list` of every repo it cloned (on a ref-change watch and at each turn end) and logs changes to the
  branch set; the session view is every local branch except the default branch, and github joins
  PRs onto it. This replaces 0020's per-thread `checkout-placed`/`checkout-left` and v1's
  per-thread probes (`plugins/github/tracking.ts`). It holds because a pod owns its clone; **local
  pods clone like cloud pods and never bind-mount the operator's checkout** (slice 9). Slices 3, 4
  and the github plugin.
