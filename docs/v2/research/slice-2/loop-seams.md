# Slice 2: agent-loop dependency surface

Read-only source investigation, 2026-11-02. Checkout: `/atlas/workspaces/atlas`, HEAD `5203552d4a305654edbbd18c42c863a73948414c`. No repository file was changed. This report is a session artifact, not a proposed slice spec or implementation. Tests were inspected, not executed; no dependencies or services were installed/started.

## Findings that determine the extraction

1. **There is already a real model port and a constructor-injected loop.** `LoopTurnRunner(TurnDeps)` does not need a pod, lease, thread store, or concrete event store. `ModelPort` is in core, not providers. The primary obstacle is the dependency graph and record/context contract, not inventing another model interface. See `/atlas/workspaces/atlas/packages/harness/src/loop/run-turn.ts:58-87,100-149` and `/atlas/workspaces/atlas/packages/core/src/ports/model.port.ts:33-44`.
2. **Do not move `buildHarness` wholesale into agent.** It is a concrete v1 filesystem composition root living inside `loop/`: JSONL event log, session registry, thread store, ledger, raw tape, default clock/IDs and destructive loop-cut implementation. `/atlas/workspaces/atlas/packages/harness/src/loop/build-harness.ts:69-110`.
3. **A model-context read must be distinct from a transcript read.** Today the loop repeatedly requests whole composed histories, converts covered history to messages, token-counts it for assembly traces, and only then removes it with `compactedHistory`. Merely implementing the same `EventLogPort.read` over a ranged backend does not meet L4. `/atlas/workspaces/atlas/packages/harness/src/loop/tracked-turn.ts:90-122,172-200`; `/atlas/workspaces/atlas/packages/core/src/assembly/pipeline.ts:34-44`; `/atlas/workspaces/atlas/packages/core/src/assembly/assemble.ts:47-54,72-87`.
4. **An in-memory fake log already exists, but its tests wrap a fake inner runner, not the full agent loop.** Most full-loop specs use scripted models plus real JSONL temp homes. A no-filesystem full-loop acceptance test is close in wiring but is not established by those specs. `/atlas/workspaces/atlas/packages/harness/src/loop/__tests__/tldr-turn-runner.spec.ts:25-49,118-123`; `/atlas/workspaces/atlas/packages/harness/src/loop/__tests__/steerable-turn.ts:106-117,150-163`.
5. **Less obvious package edges:** the loop imports filesystem-bearing `store/logs` just for a pure error formatter; loop-cut callback types are owned by a filesystem implementation; outcome vocabulary comes from `atlas-client/channel` and transitively `atlas-wire/web`; admission errors and retry normalization know SDK and credential error classes. These need explicit ownership decisions to avoid agent depending back on harness/client. See sections 1 and 6.
6. **Agent kinds already share this loop, but do not yet share one input path.** Direct `say`, main operator/notice intake, and child steering are separate producers/paths. Kind-dependent tool lists, prompt assembly and fallback models are outside the loop. Preserve that configuration boundary while unifying intake. Section 5 records the relevant assembly points.

## Design baseline

- `/atlas/workspaces/atlas/docs/v2/roadmap.md:34-46`: same loop/intake/output/hooks/prompt/dispatch for main, sub-agent and teammate; differences are configuration. Slice 2 spec is not yet written.
- `/atlas/workspaces/atlas/docs/v2/roadmap.md:81-82`: extract turn runner, retries, intake, dispatch, model port; harness imports/re-exports it; unchanged v1 behavior; test without pod, lease or filesystem store.
- `/atlas/workspaces/atlas/docs/decisions/0019-v2-package-map.md:25-35,54-55,71-72`: agent knows nothing of pod/lease/replication; pod hosts record adapters and consumes inbox; a single shared loop implementation.
- `/atlas/workspaces/atlas/docs/v2/architecture.md:338-342`: L4 requires latest summary, live context records, uncompacted tail, and prefix-sum event token estimates rather than converting/token-counting covered history.
- **Record-core is not a drop-in v1 event type.** `/atlas/workspaces/atlas/packages/core/src/record/event.ts:10-37` adds epoch/prevHash and `history-rewound`, `history-summarised`, `input-consumed`; `V2Body` explicitly excludes v1 `history-compacted`. Existing assembly expects v1 `Event[]` and `history-compacted`. `/atlas/workspaces/atlas/packages/core/src/compaction/watermark.ts:5-16`. Visibility folding exists in `/atlas/workspaces/atlas/packages/core/src/record/visibility.ts:21-41,54-96`; it is not a latest-summary/live-context model-input API.

## 1. Model port, provider boundary, faults and credentials

### Exact call chain and contract

`TurnRunner.say/resume/runTurn` → `LoopTurnRunner.runTurn` → `runTrackedTurn` → `prepareStepAssembly` → `takeModelStepWithRetry` → `takeModelStep` → **`ModelPort.step`**. Concrete v1: `AiSdkModelPort.step` → provider-prompt adaptation → `runModelStream` → **Vercel AI SDK `streamText`** → provider `LanguageModelV4.doStream`.
- Public turn contract: `/atlas/workspaces/atlas/packages/harness/src/loop/turn-runner.port.ts:6-29`. `say` accepts thread, text, images/files/uploads/context and optional abort/pause; `runTurn` consumes already-recorded input; `resume` repairs/expands input first. Concrete `say` additionally accepts `requestId` (`run-turn.ts:183-210`), not declared on the abstract `say` contract.
- `/atlas/workspaces/atlas/packages/core/src/ports/model.port.ts:9-18,20-44`:

  ```ts
  abstract class ModelPort {
    abstract readonly identity: ProviderIdentity
    traits?(): ModelTraits // imageTier?, contextWindow?
    abstract step(args: {
      assembled: Assembled
      tools: readonly ToolDeclaration[]
      signal: AbortSignal
      onChunk?: ChunkFilter
    }): Promise<ModelStepResult>
  }
  // ModelStepResult: parts, toolCalls[{callId,name,input}], finishReason, usage?
  // ChunkFilter = (chunk: Chunk) => Chunk | null
  ```

  This is the exact loop interface; it does not receive credentials, filesystem paths or a provider SDK object.
- `/atlas/workspaces/atlas/packages/harness/src/loop/model-step.ts:16-35`: forwards these fields; turns `ModelStreamError` into an explicit failed result with its cause; other exceptions escape to retry handling.
- `/atlas/workspaces/atlas/packages/harness/src/model/ai-sdk-model-port.ts:180-217,220-250`: adapter receives `LanguageModel`, optional identity/card/hooks/tape/wake; traits come from a card thunk. Converts `Assembled` to `ProviderPrompt`, hoists tool-result files for models that cannot carry them, applies `beforeRequest`.
- Same file, `:129-142`: `streamText({ model, messages, tools, stopWhen: stepCountIs(1), abortSignal, maxRetries: 0, timeout, providerOptions })`. The SDK owns one streamed model step, **not tool execution or the agent loop**. Tool conversion supplies declarations; Atlas dispatches later.
- Same file, `:57-92,120-137,146-172`: 30s response-header deadline for v4, 180s first chunk, 120s subsequent chunk timeout. Stream parts are tapped, converted to core chunks, passed through `HookChain.onChunk` then caller chunk filter, accumulated; SDK error parts become `ModelStreamError`, silent aborts without caller cancellation become `StreamStallError`. Caller cancellation permits returning accumulated partial output.

### Retry ownership and fault classification

- `/atlas/workspaces/atlas/packages/harness/src/loop/retrying-step.ts:37-60`: injected retry policy, waiting/log callbacks, sleep, jitter, clock-jump subscription and give-up callback. Defaults still use timers, `Math.random` and `Date.now` (`:62-77,162-167,203-212`). There is no injectable `now` on this seam today.
- Same file, `:113-138,175-199`: both pre-stream throws and returned stream failures are classified. A previously thrown fault remains a throw when exhausted; returned stream failure stays a failed `SteppedTurn`. Admission-blocked errors return immediately, without retry-budget spending.
- Same file, `:141-146,214-227`: fallback consultation occurs at most once per step, only after a transient budget is spent or for credential-scoped quota/auth. A successful switch resets attempt count once. Permanent request/route/delivery faults do not consult fallback.
- Same file, `:244-265`: retry sleeps are abortable and clock-jump-aware. After backoff, `prepare` drains new input, re-reads/reassembles, and repeats preparation if compaction happened. This is a behavior-critical fresh-context seam, not retrying an immutable original prompt.
- `/atlas/workspaces/atlas/packages/core/src/models/retry.ts:21-26,57-96`: default five attempts, 1s exponential base, 10s backoff cap, 60s maximum retry-after. Half-to-full jitter; server retry time is a floor; too-long reset interval or spent attempts ends retries.
- `/atlas/workspaces/atlas/packages/harness/src/model/failure.ts:1-19,72-83,104-145`: SDK-aware normalization unwraps cause chains, remembers normalization/provenance, reads provider status/code/type/headers, distinguishes delivery/credential/network/stall/cancellation. It imports `APICallError`, `StreamProviderError`, `CredentialError`, and `MissingKeyError`—**the loop is abstract over model invocation, but retry normalization is not SDK-independent**.
- Pure classification is `/atlas/workspaces/atlas/packages/core/src/models/provider-failure.ts:19-58,161-249`: normalized kind/scope/retry; auth/quota require credential evidence; 403/404 route denial; overflow/request faults; stalls/rate-limit/overload/server/network transient cases. Bare 401 without proven authorization delivery is a delivery fault (`:153-159,192-196`), not grounds to condemn an account.
- `/atlas/workspaces/atlas/packages/harness/src/loop/run-turn.ts:52-55,152-180`: structurally probes `model.switch()` rather than importing composition fallback machinery. Keep this capability explicit if designing a new port, or preserve the probe for v1 compatibility.
- `/atlas/workspaces/atlas/packages/harness/src/model/run-failure.ts:8-11,35`: escaped/returned failures become core run-failure data through normalization, with default wall-clock time. `/atlas/workspaces/atlas/packages/harness/src/loop/recorded-failures.ts:1-53` and `run-turn.ts:267-287` persist failure events while preserving the throw/result distinction.

### Provider and credential coupling belongs below the port

- `/atlas/workspaces/atlas/packages/harness/src/providers/adapter.ts:5-20`: **`ProviderAdapter`** is a separate lower-level interface: id/label/cards, `model({ card, effort, accountId? }): LanguageModelV4`, provider effort options. It is not what the loop calls.
- `/atlas/workspaces/atlas/packages/harness/src/providers/inference-adapter.ts:61-89`: resolves `CredentialPort.read` when building/using the provider route, obtains a nonempty key, builds SDK provider with injected fetch, wraps admission, carries account identity. Anthropic and OpenAI equivalents own `CredentialPort` at `/atlas/workspaces/atlas/packages/harness/src/providers/anthropic-adapter.ts:17-31,44-50` and `/atlas/workspaces/atlas/packages/harness/src/providers/openai-adapter.ts:20-38,50-61`; they delegate OAuth/key handling, not the loop.
- `/atlas/workspaces/atlas/packages/harness/src/providers/provider-key.ts:18-26`: missing/empty secret throws `MissingKeyError` marked with account id and `authorizationDelivered: false`.
- `/atlas/workspaces/atlas/packages/harness/src/providers/provider-admission.ts:13-43`: adapter optional admission uses `CredentialAvailabilityPort`, clock, credential revision and account/provider/model key.
- `/atlas/workspaces/atlas/packages/harness/src/model/admitted-model.ts:23-37,40-50,166-208`: v4 wrapper admits before request, throws `ModelAdmissionBlockedError` on denial, attaches failure provenance, completes/promotes permits based on generated/streamed outcomes.
- `/atlas/workspaces/atlas/packages/harness/src/loop/waiting-outcome.ts:18-22`: blocked admission → `WaitingForModel`, plus optional observer. `/atlas/workspaces/atlas/packages/harness/src/model-recovery/waiting-of-block.ts:11-34` maps availability snapshot into a core waiting episode.
- `/atlas/workspaces/atlas/packages/harness/src/model-recovery/wait-state.ts:16-24,196-233`: observer is a `Pick<ModelWaitState, 'observe'|'admitted'|'blocked'>`; implementation requires record reads/appends, IDs and thread-parent lookup, folds root waiting state using whole `readOwn`. The **observer contract can move independently of this implementation**; do not require thread-store/root-session resolution in agent.

## 2. Tool dispatch, policy/hooks, parallelism and result recording

### Exact seam

- `/atlas/workspaces/atlas/packages/harness/src/tools/dispatch.ts:39-60`:

  ```ts
  type DispatchableCall = { callId: CallId; name: string; input: unknown; runId: RunId; threadId: ThreadId }
  type DispatchArgs = {
    call: DispatchableCall; signal: AbortSignal; projectDirectory: string
    homeDirectory?: string; activeWorktree?: ActiveWorktree
    events: readonly Event[]
    onOutput?: OnToolOutput
    onDispatchStarted?: (draft: EventDraft) => Promise<void>
  }
  abstract class ToolDispatcher {
    abstract dispatch(args: DispatchArgs): Promise<readonly EventDraft[]>
  }
  ```

  Dispatcher returns drafts; the loop persists them. Passing the whole event list is another L4/current-state seam, not merely storage plumbing.
- `/atlas/workspaces/atlas/packages/harness/src/loop/step-drafts.ts:13-40`: model output records assistant parts and `tool-called` with ordinal; cancelled output records partial assistant content plus denied calls. `/atlas/workspaces/atlas/packages/harness/src/loop/tracked-turn.ts:254-270`: call IDs are deduplicated against the read history before append; tool output is **not** executed by `streamText`. Next iteration settles pending calls first (`:90-109`).
- `/atlas/workspaces/atlas/packages/harness/src/loop/settle-pending.ts:31-67,70-105`: reads log, filters owned rows, orders pending calls by ordinal, partitions concurrency-safe runs, derives home/worktree/project paths. Each run uses `Promise.all`; separate runs are sequential. `onDispatchStarted` appends `tool-dispatched` before invocation. Each returned draft batch is appended under the call's original run ID; streaming output callback is separate from durable recording. Later runs refresh the history and fold worktree/home changes from prior results.
- `/atlas/workspaces/atlas/packages/core/src/policy/concurrency.ts:12-28,31-63`: safe parallelism requires declaration, explicit safety predicate, valid input, Read effect, predicate true. Write/destructive tools are always singleton barriers; undeclared/invalid/throwing predicates are unsafe. Consecutive safe calls form a parallel run. Results are appended as promises finish, not forced into ordinal completion order.

### Hooked dispatcher lifecycle

`HookedToolDispatcher` (`dispatch.ts:70-180,183-291`):
1. Find tool definition; unknown/invalid input produce model-readable error results, not throws (`:106-113`).
2. Consult ordered `beforeTool` hooks, serially threading rewritten input (`:205-226`); pure `resolveBeforeTool` gathers drafts and lets a denial win (`:123-133`).
3. Persist dispatch-start marker; fail closed without invoking tool if marker persistence fails (`:136-147`). `/atlas/workspaces/atlas/packages/harness/src/tools/dispatch-drafts.ts:12-35` owns that contract.
4. Invoke `definition.invoke` with input, abort, idempotency key `${runId}:${callId}`, paths/worktree/thread/output callback, optional capture flag (`dispatch.ts:229-252`). Exceptions become failed `ToolOutcome`, with diagnostic logging (`:253-262`).
5. Quality review, result draft, bounded afterTool observer drafts and optional review nudge (`:161-180,265-290`). Quality is injected `QualityReviewPort`; `/atlas/workspaces/atlas/packages/harness/src/tools/quality-dispatch.ts:100,134` still uses wall-clock time.
6. `/atlas/workspaces/atlas/packages/harness/src/tools/tool-result-draft.ts:3-30`: successful results carry raw output, modelText/modelParts and review data; failures carry error text and optional interruption.

**Approval nuance:** the generic before-tool vocabulary currently has **Allow and Deny only**, no Ask/approval disposition: `/atlas/workspaces/atlas/packages/core/src/policy/before-tool.ts:4-19,64-87`. The abstract settling result can report `paused`, and tracked-turn handles it, but `createSettlePending`'s implementation always returns `{}` after execution (`settle-pending.ts:26-29,108`); it does not itself implement a human-approval pause. Do not infer an approval state machine from that unused capability. Operator-interaction tools and injected hooks can wait on their own ports, but those are outside this dispatch contract.

Hook budget is 5s by default (`/atlas/workspaces/atlas/packages/harness/src/hooks/budget.ts:1,23-40,44-80`). Specific before-tool fallback: overrun abstains/allows; other mishaps deny (`/atlas/workspaces/atlas/packages/harness/src/tools/hook-silence.ts:18-26`). Preserve this asymmetry, not an assumed universal fail-closed policy.

### Execution is below tools, not imported by the loop

`ToolDefinition.invoke` is the execution seam. Example `/atlas/workspaces/atlas/packages/harness/src/tools/builtin/bash.ts:21-31,60-80,130-141` depends on shell registry, `FileSystemPort` and `ProcessPort`, with local concrete defaults. `/atlas/workspaces/atlas/packages/harness/src/execution/register-execution.ts:17-35` supplies local/login/session-env process adapters, local filesystem and Docker engine. Actual host process creation is `/atlas/workspaces/atlas/packages/harness/src/execution/local-process.ts:72,85` (`Bun.spawn`); local filesystem imports node fs at `/atlas/workspaces/atlas/packages/harness/src/execution/local-filesystem.ts:1-11`. Agent needs dispatch/declaration/definition contracts, not these implementations, sandbox adapters or built-in cloud tools.

### Recovery

`settleCrashedCalls` uses only own-log read, append, nextRunId and effect resolver (`/atlas/workspaces/atlas/packages/harness/src/loop/dispatch-recovery.ts:11-45`). Dispatched-but-unsettled non-Read calls become interrupted results saying effects are unknown; Read calls remain retryable. The durable marker is essential to restart behavior. Do not replace this with blindly replaying all pending calls.

## 3. Record/event log: APIs, whole reads and minimum information

### Existing port and concrete semantics

- `/atlas/workspaces/atlas/packages/core/src/ports/event-log.port.ts:5-33`: `append` stamps drafts and returns events; `replace` replaces own history; `read({threadId,fromSeq?,upTo?})`; `refresh`; `head`; `readOwn`.
- `/atlas/workspaces/atlas/packages/harness/src/store/sessions/event-log.ts:46-67`: append/replace serialized through session registry queue. `read` composes parent/reference-fork segments (`:69-112`); `readOwn` excludes inherited segments (`:115-126`). **The loop relies on the distinction**: model context may include inherited history, while pending dispatch, awaitsReply and most guards use owned rows.
- Same file, `:95-112,295-308`: range read filters cached/full segment arrays; `fromSeq` is exclusive, `upTo` inclusive. This v1 implementation is not true bounded disk I/O merely because the port exposes ranges.
- Same file, `:152-213`: timestamp/IDs/seq stamping, context reuse, family ownership, JSONL append, metadata update and cached indexes belong to store. Agent should provide drafts, not stamp/fence physical storage.
- Same file, `:271-290`: context-reuse planning triggers a whole composed `read` when appending context drafts. This hidden read sits below the loop's explicit call sites.
- V1 loop-cut is even more concrete: `/atlas/workspaces/atlas/packages/harness/src/store/sessions/ops/cut-loop.ts:14-19,32-65` defines `ApplyLoopCut` callback and its store adapter; checks own head against `throughSeq`, computes rewind plan, truncates log, appends notice and reappends surviving events. **Keep v1 adapter behavior, but do not make physical truncate the agent contract or v2 implementation.**

### Every explicit whole-log read in production loop/

All calls below omit `fromSeq`/`upTo`; none of the normal loop reads uses the existing ranged API.

| File (absolute path)                                                     | Lines                | Purpose                                                                                                         |
| ------------------------------------------------------------------------ | -------------------- | --------------------------------------------------------------------------------------------------------------- |
| `/atlas/workspaces/atlas/packages/harness/src/loop/tracked-turn.ts`      | 75, 80, 90, 122, 181 | Interrupted committed-state; opening project path; each iteration; post-intake refresh; every retry preparation |
| `/atlas/workspaces/atlas/packages/harness/src/loop/settle-pending.ts`    | 71, 85               | Discover pending owned calls and current paths; refresh between execution runs                                  |
| `/atlas/workspaces/atlas/packages/harness/src/loop/close-quiet-step.ts`  | 33                   | Detect new input before completion                                                                              |
| `/atlas/workspaces/atlas/packages/harness/src/loop/resume-turn.ts`       | 18                   | Resume expansion from unresolved user input                                                                     |
| `/atlas/workspaces/atlas/packages/harness/src/loop/shell-completion.ts`  | 16                   | Add shell-ending completion nudge if needed                                                                     |
| `/atlas/workspaces/atlas/packages/harness/src/loop/tldr-turn-runner.ts`  | 69, 84               | Compute footer range and recheck current due state                                                              |
| `/atlas/workspaces/atlas/packages/harness/src/loop/dispatch-recovery.ts` | 34 (`readOwn`)       | Resolve dispatched calls abandoned by a process restart                                                         |

Direct loop mutation is append, not replace/refresh/head. Additional broad reads are delegated to loop-cut (`cut-loop.ts:39,44`), compaction (`/atlas/workspaces/atlas/packages/harness/src/composition/compact-turn.ts:51`, `/atlas/workspaces/atlas/packages/harness/src/store/compact.ts:114`), waiting-state reload (`/atlas/workspaces/atlas/packages/harness/src/model-recovery/wait-state.ts:224`) and context dedup (`event-log.ts:286`).

### What the record supplies beyond model messages

A narrow model-context projection alone cannot replace every `log.read` above. The loop also needs:
- own-head/seen-through cursor and new-message detection; awaitsReply; whether assistant committed after the last user; latest unresolved input for resume;
- pending/dispatched/settled tool calls, ordinal/run IDs, effect/recovery information and global call-ID deduplication;
- current home/project/worktree, including inherited context versus own actionable events;
- repeat/semantic-watch windows and a conditional cut at the observed head;
- live nudges and lifecycle/notice state (shell endings, agent reports/endings, service/subscription state);
- usage/finish-state failure drafts and optional footer range anchors.

Call sites establishing these needs: `/atlas/workspaces/atlas/packages/harness/src/loop/tracked-turn.ts:71-85,90-169,254-267`; `/atlas/workspaces/atlas/packages/harness/src/loop/turn-position.ts:1-84`; `/atlas/workspaces/atlas/packages/harness/src/loop/settle-pending.ts:70-105`; `/atlas/workspaces/atlas/packages/harness/src/loop/loop-guard.ts:87-129`; `/atlas/workspaces/atlas/packages/harness/src/loop/loop-watchdog.ts:67-113,130-224`.

**Extraction implication (recommendation, not existing API):** distinguish (a) append drafts, (b) current decision/dispatch state or bounded own-tail windows, and (c) model-context snapshot. V1 adapters can initially derive these using existing folds without changing behavior. A v2 host can supply incrementally materialized/ranged state. Do not put leases, epochs or replication in `TurnDeps` just to bridge the new store.

## 4. Per-step context assembly, live context and compaction

### Exact per-turn and per-step sequence

1. `/atlas/workspaces/atlas/packages/harness/src/loop/tracked-turn.ts:54-85`: set up per-turn position and once-per-turn compaction closure, derive opening project directory from a log read, run `beforeTurn`, append returned drafts.
2. `:87-122`: relocation pause gate; read all events; filter owned rows; settle pending tool calls before consuming more input; drain input with append-before-ack; re-read if anything was drained or wakes the turn.
3. `:125-167`: repeat-loop guard and semantic watchdog see owned history; successful cuts reset prior assembly and restart iteration. `:169`: remember own seen-through seq.
4. `:194-211` (the requested ~190-218 region): call `prepareStepAssembly({threadId,events,step:position.modelSteps,previous:position.previous,signal})`. Failed preparation fails turn; compaction resets previous and restarts; successful assembly becomes `position.previous`.
5. `:213-222`: dynamic tool declarations are read for the model request, plus onChunk/abort/retry/prepare callbacks. `prepareAttempt` (`:172-191`) drains again, reads the latest history, records its own head, rebuilds with `previous: undefined`, and stores successful assembly. Retry preparation intentionally does **not** trust the prior assembled cache.
6. `:224-247`: admission wait handling, model-step bookkeeping, raw retry of retriable empty output, usage tally. Fresh input encountered during retry invalidates prior assembly when necessary.
7. `:254-284`: record interrupted or normal output; next tool-bearing step returns to settlement; quiet output runs close/late-input checks. `/atlas/workspaces/atlas/packages/harness/src/loop/close-quiet-step.ts:33-88` rechecks external appends, drains again, nudges silent steps if needed, and invokes `afterTurn` only on its normal completion route. It is **not** a universal finally hook on failed/interrupted/paused outcomes.

### Inputs required by assembly today

`RuleContext` is exact at `/atlas/workspaces/atlas/packages/core/src/assembly/rule.ts:8-16`:
- all `Event[]` (composed inherited + own rows);
- thread ID, model step number;
- current provider identity;
- token-count function;
- optional previous Assembled and upload-placement map.

`AssemblyPipeline` is `{ rules, annotators }` (`/atlas/workspaces/atlas/packages/core/src/assembly/pipeline.ts:14-17`). Rule closures add compiled prompt source, launch directory, optional repo root, synchronous running-shell/service/agent state suppliers (`:19-45,56-81`). These injected live state suppliers are distinct from `context-loaded` records: both contribute context.

`prepareStepAssembly` `/atlas/workspaces/atlas/packages/harness/src/loop/step-prepare.ts:89-157`:
- scans own user rows for **all** uploads; “current” uploads are those since last assistant output;
- awaits optional `SaidUploadsPort.place` before pure assembly (`:115-124`), forwarding abort;
- constructs RuleContext and runs core `assemble` (`:126-140`);
- applies `hooks.beforeStep` after rules and annotators, then counts final tokens, reads model context window, reports onContext (`:142-146`);
- attempts injected compaction, rejects overflow, validates exchange shape (`:148-155`).

Upload interface is `/atlas/workspaces/atlas/packages/harness/src/uploads/said-uploads.port.ts:3-9`; it is already a small host capability, not a reason for agent to import placement/download/filesystem implementations.

### Core stages and why current code violates L4

- `/atlas/workspaces/atlas/packages/core/src/assembly/assemble.ts:58-91`: starts empty each run; ordered rules then annotators. Default rule-failure policy skips the failed rule using prior input. Every stage records token counts (`:47-54,72-87`). `previous` is contextual input, not automatic transcript caching in assemble.
- `/atlas/workspaces/atlas/packages/core/src/assembly/pipeline.ts:34-44`: system prompt → **messagesFromEvents** → agent endings → **compactedHistory** → image cleanup/projection → worktree → optional live shells/services/agents. Annotators supply cache breakpoints/cache keys (`:48-53`).
- `/atlas/workspaces/atlas/packages/core/src/assembly/rules/messages-from-events.ts:184-203,426-435`: walks every event; computes current context IDs, live nudge IDs, call IDs and lifecycle context; converts to message groups and settled tool results. Arbitrary result output is stringified (`:54-64,86-94`) before compaction removes covered message entries.
- `/atlas/workspaces/atlas/packages/core/src/context/supersede.ts:13-16,24-40`: live context is a backwards scan of `context-loaded` records; same slot+key supersedes; same slot+basename+same content also supersedes across relocated paths; legacy session `execution-location` context is excluded. Do not substitute “last context per slot” or forget relocated-key dedup.
- `/atlas/workspaces/atlas/packages/core/src/assembly/rules/compacted-history.ts:16-19,26-32,46-64`: reads **all** `history-compacted` watermarks, retains `context-loaded` origins inside covered spans, replaces covered model messages with summary user-context blocks in origin order. There may be multiple/nontrivial compaction ranges; current behavior is not simply take the last event and discard all earlier data.
- `/atlas/workspaces/atlas/packages/core/src/compaction/watermark.ts:7-16,34-55,65-68`: helpers distinguish all watermarks, deepest boundary, physical replacement versus hidden-but-rewindable history.
- Thus covered rows are read, rendered, serialized and token-counted in pre-compaction trace stages. **An L4 snapshot API must filter before `messagesFromEvents`, and it must also preserve origins/order, live contexts, current runtime facts, complete tool exchanges, current nudges and history semantics.** It cannot just pass `events.slice(lastSummary.seq)` to the unchanged pipeline.

### Compaction execution boundary

- `/atlas/workspaces/atlas/packages/harness/src/loop/step-prepare.ts:67-86`: automatic compaction allowed at most once per turn, based on settings threshold; closure sets compacted before invoking callback. On success, loop rebuilds; if unavailable/unsuccessful, normal overflow checks still apply.
- `/atlas/workspaces/atlas/packages/harness/src/composition/turn-wiring.ts:99-108,168-174`: wires callback to `compactTurn` with event log/thread store/agent registry/summarizer and loop-cut to concrete store machinery.
- `/atlas/workspaces/atlas/packages/harness/src/composition/compact-turn.ts:42-55,57-81,100-108,120-140`: computes watermark from whole history, preserves most recent turn for automatic/current behavior, selects nondestructive compaction versus explicit destructive summary.
- `/atlas/workspaces/atlas/packages/harness/src/store/compact.ts:101-152`: whole-log guard/range calculation, injected summarizer, then `threads.compact` or `threads.summarise` + agent-child removal.
- `/atlas/workspaces/atlas/packages/core/src/compaction/compaction-plan.ts:1-13`: planner uses event-token estimation on filtered event arrays, not maintained prefix sums. L4's estimate index remains a design gap, not an already available loop input.

## 5. Hooks, prompt fragments and intake assembly

### Hook machinery versus hook implementations

- `/atlas/workspaces/atlas/packages/harness/src/hooks/registry.ts:26-48,93-117`: `HookChain` is concrete but IO-free apart from bounded async execution/timers; registered hooks are name/order/run; core `orderHooks` establishes order. Loop-facing phases are beforeTurn/beforeStep/afterTurn; model adapter owns beforeRequest/onChunk; dispatcher owns beforeTool/afterTool. afterShell/onThreadOpen are lifecycle entry points outside the primary stepping loop.
- Same file `:119-190`: outcome phases convert hook results to event drafts, transformation phases thread prior value through ordered hooks, chunk chain can suppress a chunk. Chain budget failure generally preserves prior value or returns no drafts; before-tool special policy described above.
- `/atlas/workspaces/atlas/packages/harness/src/hooks/resolve-hooks.ts:23-45`: DI resolver constructs chain from per-phase registrations. `/atlas/workspaces/atlas/packages/harness/src/hooks/register-hooks.ts:49-129`: built-ins include path resolution, read-before-write, classifier, service shape, facts prewarm, skill suggestion, file state recording, plan mirroring, outside-project/worktree/checkout tracking and invalidation. These use concrete execution/session/file/skill/decision dependencies and should remain injected implementations rather than imports of the agent loop.
- `/atlas/workspaces/atlas/packages/harness/src/hooks/load-instructions.ts:17-65`: filesystem instruction reader hook produces `context-loaded` drafts, with optional read-state tracking. The loop handles resulting records, not instruction-file lookup. Nested instructions/memory use the same hook/context mechanism; do not move their host lookup simply because prompt text reaches assembly.

### Prompt composition

- `/atlas/workspaces/atlas/packages/harness/src/prompt/registry.ts:13-42,49-81`: `PromptRegistry.compile(PromptContext)` filters fragments by applies, trims text, records skipped reasons, joins in registration order; `InMemoryPromptRegistry` memoizes context keys plus volatile fragment stamps. It is not a filesystem store despite its name.
- `/atlas/workspaces/atlas/packages/core/src/assembly/rules/system-prompt.ts:7-25`: pure rule calls a prompt thunk each assembly with project directory folded from events; appends compiled prompt blocks.
- `/atlas/workspaces/atlas/packages/harness/src/composition/turn-wiring.ts:128-160`: main thunk includes Main agent, current provider/model card, project path, current execution placement/runner; pipeline captures running shell/agent/service sources.
- Same file `:193-231`: child assembly thunk uses child prompt, child model and working dir; teammate gets Main prompt agent, other children Sub. The loop itself contains no main-vs-child branch.
- `/atlas/workspaces/atlas/packages/harness/src/agents/registry/child-runner.ts:63-74,157-220`: outside-loop kind branches set deny lists, teammate spawnable visibility, model, filtered tools, observing log, hooks/quality, child pipeline and child steering. These are exactly the configuration choices slice 2 must name, not migrate into a kind switch inside agent.

### Input paths and their current guarantees

1. **Direct entry**: `LoopTurnRunner.say` appends supplied context + expanded context + user-said, then runs (`run-turn.ts:183-215`). `resume` consults the record and expansion helper (`:218-237`; `/atlas/workspaces/atlas/packages/harness/src/loop/resume-turn.ts:11-27`). These do not themselves call `MessageIntake.submit`.
2. **Active-turn drain**: `/atlas/workspaces/atlas/packages/harness/src/loop/pending-intake.ts:3-8,14-53`: batch = drafts/wakesTurn/optional acknowledge/release. Abort after reservation or append failure releases; successful append then acknowledges. A zero-draft wake can still wake the turn. `TurnDeps.drainPending` (`run-turn.ts:72`) omits signal in its declared input, while appendPending accepts/forwards signal (`pending-intake.ts:21-34`); tightening this seam requires preserving abort behavior.
3. **Shared main operator + notice fan-in**: `/atlas/workspaces/atlas/packages/harness/src/intake/message-intake.ts:7-21,58-77,121-185`: `IntakeSource` supplies prepare, pending-thread enumeration, subscription, optional witness/submit. `MessageIntake` serializes reservations per thread, combines batches, acknowledges after commit, releases on failure; driver registration/wakes/hold/suspend are also owned here (`:93-119,198-259,294-370`). Default Date.now and retry timers exist, but no pod/lease/store is required by this class.
4. **Concrete producers**: `/atlas/workspaces/atlas/packages/harness/src/intake/sources.ts:8-41`: adapts shell/agent/service registries and operator queues. `/atlas/workspaces/atlas/packages/harness/src/composition/intake-binding.ts:30-55` orders notices, plugins, operator; adds wait-state gating and child-registry wake fallback. Source adapters are host/plugin concerns, unlike generic intake batching/wake logic.
5. **Child steering bypass/fan-in**: `/atlas/workspaces/atlas/packages/harness/src/agents/registry/child-runner.ts:116-138,151-155,200-217`: child peek/ack steering is converted to user-said with ParentAgent origin, then combined separately with drained notices. This is not the same submit queue as main operator input. Agent report/end notices arrive through registry notice sources above.
6. **Pending queue semantics**: `/atlas/workspaces/atlas/packages/harness/src/pending/pending-queue.ts:12-53,71-86,173-201`: message/command entries, reservations, update/remove/take-back; expansion only for operator-origin messages; draft context placed immediately before saidBody. Runtime dependency on `EPendingEdit` from `atlas-wire` at `:9`; `SubmittedInput` in message-intake is currently derived from this concrete queue (`message-intake.ts:21`). That type-level dependency also needs a home if generic intake moves.

Extraction recommendation: keep generic batch reservation/ack/release and drivers together; inject source adapters and kind policy. A pod inbox consumer can be another input source/driver adapter. Preserve append-before-ack semantics; don't equate a successful model call with consuming input.

## 6. Host/pod dependencies and import census

### Direct ambient host effects in loop/

No production `loop/*.ts` directly imports `node:*` or calls `Bun.spawn`/`Bun.file`. It is nevertheless **not** currently a host-independent import graph:
- `/atlas/workspaces/atlas/packages/harness/src/loop/run-turn.ts:146`: default `process.cwd()`; accepts injected launchDirectory.
- `/atlas/workspaces/atlas/packages/harness/src/loop/settle-pending.ts:78`: independent `process.cwd()` fallback.
- `/atlas/workspaces/atlas/packages/harness/src/loop/retrying-step.ts:62-77,164,203`: timers, random jitter, wall-clock. Sleep/jitter injected; now is not.
- `/atlas/workspaces/atlas/packages/harness/src/loop/build-harness.ts:76,95`: process pid raw-tape scope, cwd fallback, plus the concrete stores below.
- State-only pause/abort uses standard JS `AbortController`/`AbortSignal`, not pod machinery. `/atlas/workspaces/atlas/packages/harness/src/loop/pause-signal.ts:1-36`.

### Every direct external-to-loop edge (excluding core), with effect/ownership

Rows distinguish **value/mixed imports** (real runtime graph) from **type-only** imports (erased at runtime, but illegal package ownership may remain). Relative import targets below are fully anchored absolute files.

| Loop source anchor                                                           | Target and concern                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/atlas/workspaces/atlas/packages/harness/src/loop/build-harness.ts:1,19-24` | Type `ai.LanguageModel`; type HookChain/ledger/dispatcher; values `/atlas/workspaces/atlas/packages/harness/src/ledger/jsonl/index.ts`, `/atlas/workspaces/atlas/packages/harness/src/model/ai-sdk-model-port.ts`, `/atlas/workspaces/atlas/packages/harness/src/model/raw-tape.ts` (SDK, filesystem tape, credential-independent model adapter). |
| `build-harness.ts:25-31`                                                     | Values `/atlas/workspaces/atlas/packages/harness/src/store/index.ts` (RandomIds/SystemClock), `store/paths.ts`, `store/sessions/event-log.ts`, `store/sessions/ops/cut-loop.ts`, `store/sessions/registry.ts`, `store/sessions/thread-store.ts`; type ThreadStorePort through store barrel. Concrete v1 host assembly, not reusable agent.        |
| `/atlas/workspaces/atlas/packages/harness/src/loop/run-turn.ts:22-28`        | Values `model/failure-diagnostics.ts`, **`store/logs.ts`**; type `hooks/registry.ts`, `uploads/said-uploads.port.ts`, `store/sessions/ops/cut-loop.ts`, `tools/dispatch.ts`, `model-recovery/wait-state.ts`.                                                                                                                                      |
| `run-turn.ts:32-36`                                                          | Type `pending/index.ts`, `power/sleep-prevention.ts`; values `ledger/record-turn-spend.ts`, `model/run-failure.ts`. Paths under `/atlas/workspaces/atlas/packages/harness/src/`.                                                                                                                                                                  |
| `/atlas/workspaces/atlas/packages/harness/src/loop/loop-guard.ts:19-21`      | Value `/atlas/workspaces/atlas/packages/harness/src/classifier/tool-lens.ts` (pure core shell/deed analysis + zod, not process execution); type `/atlas/workspaces/atlas/packages/harness/src/store/sessions/ops/cut-loop.ts`; value `model/turn-fault.ts`.                                                                                       |
| `/atlas/workspaces/atlas/packages/harness/src/loop/loop-watchdog.ts:23`      | Type ApplyLoopCut from same store implementation. DecisionPort is core; external decision client is injected, not imported.                                                                                                                                                                                                                       |
| `/atlas/workspaces/atlas/packages/harness/src/loop/model-step.ts:9-10`       | Type `model/admission-blocked.ts`; value `model/errors.ts`.                                                                                                                                                                                                                                                                                       |
| `/atlas/workspaces/atlas/packages/harness/src/loop/retrying-step.ts:19-21`   | Values `model/admission-blocked.ts`, `model/cause-chain.ts`, `model/failure.ts`; latter reaches SDK and credential/provider error vocabulary.                                                                                                                                                                                                     |
| `/atlas/workspaces/atlas/packages/harness/src/loop/recorded-failures.ts:1`   | Value `model/run-failure.ts` → normalizer and default wall clock.                                                                                                                                                                                                                                                                                 |
| `/atlas/workspaces/atlas/packages/harness/src/loop/resume-turn.ts:10`        | Type ExpandContext from `pending/index.ts`.                                                                                                                                                                                                                                                                                                       |
| `/atlas/workspaces/atlas/packages/harness/src/loop/settle-pending.ts:20`     | Type DispatchableCall/ToolDispatcher from `tools/dispatch.ts`. No execution-adapter runtime import.                                                                                                                                                                                                                                               |
| `/atlas/workspaces/atlas/packages/harness/src/loop/step-prepare.ts:18-20`    | Type HookChain, SaidUploadsPort; value `model/turn-fault.ts`.                                                                                                                                                                                                                                                                                     |
| `/atlas/workspaces/atlas/packages/harness/src/loop/swallowed-outcome.ts:3`   | Value `model/turn-fault.ts`.                                                                                                                                                                                                                                                                                                                      |
| `/atlas/workspaces/atlas/packages/harness/src/loop/tldr-turn-runner.ts:2,4`  | Type SDK LanguageModel; value `model/tldr.ts`, a second `streamText` consumer generating structured footer output, not the primary agent model port.                                                                                                                                                                                              |
| `/atlas/workspaces/atlas/packages/harness/src/loop/tracked-turn.ts:19`       | Type TurnSpendTally from `ledger/record-turn-spend.ts`.                                                                                                                                                                                                                                                                                           |
| `/atlas/workspaces/atlas/packages/harness/src/loop/turn-faults.ts:16`        | Value `model/turn-fault.ts`.                                                                                                                                                                                                                                                                                                                      |
| `/atlas/workspaces/atlas/packages/harness/src/loop/turn-outcome.ts:1`        | Runtime re-export ETurnStatus + type TurnOutcome from **`@dltech/atlas-client/channel`**. `/atlas/workspaces/atlas/packages/client/src/channel/turn-outcome.ts:1-20` imports/re-exports status from `@dltech/atlas-wire/web`. Outcome vocabulary belongs below clients for a clean agent dependency direction.                                    |
| `/atlas/workspaces/atlas/packages/harness/src/loop/turn-policy.ts:3`         | Type PendingSaid from pending. Policy command entry points remain wrappers outside stepping.                                                                                                                                                                                                                                                      |
| `/atlas/workspaces/atlas/packages/harness/src/loop/turn-position.ts:10`      | Value `model/turn-fault.ts`.                                                                                                                                                                                                                                                                                                                      |
| `/atlas/workspaces/atlas/packages/harness/src/loop/waiting-outcome.ts:3`     | Value `model-recovery/waiting-of-block.ts` (pure waiting mapping; class identity from model admission).                                                                                                                                                                                                                                           |

For rows using short target names, the target root is `/atlas/workspaces/atlas/packages/harness/src/`; source path is given once per grouped row. All other imports in production loop files are core or sibling loop modules. `tracked-turn-deps.ts:5-14` additionally uses an inline type import of `./run-turn`, so moving only selected files must preserve this type cycle or replace it with a shared dependency contract.

### Concrete transitive IO and hidden ownership traps

- **Pure helper in filesystem module:** `run-turn.ts:23` → `/atlas/workspaces/atlas/packages/harness/src/store/logs.ts:1-15,112-117`. `logFieldsOf` itself is pure, but module imports fs/path, atlas paths, session paths and session registry. Moving this formatter (or injecting formatting) is enough; moving JsonlLog is not. Dispatcher and dispatch-drafts also import it (`tools/dispatch.ts:25`, `tools/dispatch-drafts.ts:3`).
- **Concrete build root:** build-harness → JSONL ledger `/atlas/workspaces/atlas/packages/harness/src/ledger/jsonl/jsonl-turn-ledger.ts:1-2`; raw tape `/atlas/workspaces/atlas/packages/harness/src/model/raw-tape.ts:1-2,43` (fs/path/env); event log `store/sessions/event-log.ts:1-2`; registry `store/sessions/registry.ts:1-2`; paths `store/paths.ts:1-3,34` (fs/os/path/env). Default IDs `/atlas/workspaces/atlas/packages/harness/src/store/ids.ts:1,16-28` use crypto randomUUID; default clock `/atlas/workspaces/atlas/packages/harness/src/store/clock.ts:3-5` uses Date.
- **Barrel risk:** build-harness imports store/index values; that barrel also re-exports rewinding, relocation, locking, compaction and authority (`store/index.ts:10-30,44-73`). Do not treat a named import as a guarantee that this module graph only contains clock/ID code.
- **Loop-cut types:** guard/watchdog/run-turn import type from `cut-loop.ts`; erased today, but the target implementation imports registry and `log-edits` (`cut-loop.ts:11-12`), and `/atlas/workspaces/atlas/packages/harness/src/store/sessions/ops/log-edits.ts:1-2,66` does fs/path/pid writes. Move callback type ownership; keep store adapter host-side.
- **Power type:** `/atlas/workspaces/atlas/packages/harness/src/power/sleep-prevention.ts:1-3,68-69` uses child_process/util/process; loop import is type-only and loop calls injected acquire (`run-turn.ts:254,289`). Split a tiny capability interface from host implementation if package rules require it; do not accidentally convert the import to a value.
- **Wait-state type:** run-turn's ModelWaitObserver references a class requiring ThreadStorePort (`model-recovery/wait-state.ts:13-24`) via type only. Actual loop runtime reaches only pure waiting-of-block, not thread resolution. Same principle applies.
- **Usage:** `/atlas/workspaces/atlas/packages/harness/src/ledger/record-turn-spend.ts:17-22,40-78,86-108` calls injected ledger/telemetry and clock, with `new Date` fallback; clock remains active even without a ledger. Its pure tally/observer contract can move; JSONL ledger must not.
- **Hook timers:** `hooks/registry.ts` → `hooks/budget.ts:29-40,71-80`. Async timeout machinery is generic, not pod resource enforcement.
- **Watchdog name is misleading for v2 §11:** `loop-watchdog.ts` is semantic repetition detection via injected `DecisionPort`, not memory/CPU/lease liveness monitoring. No pod watchdog implementation belongs in this module by association.
- **No direct `cloud/` or `composition/` import occurs in production loop files.** These are wiring consumers of loop ports, not loop dependencies. Concrete tool/hook registries can contain cloud/execution/plugin behavior, but it enters by injection. The runtime impurity already proven above does not require assuming all type-only graph edges execute.
- **Footer is optional feature/wrapper:** `/atlas/workspaces/atlas/packages/harness/src/model/tldr.ts:58-93` calls SDK `streamText` directly with object output and no SDK retries; `TldrTurnRunner` reads history and appends footer. Main assembly wiring selects it conditionally (`composition/turn-wiring.ts:242-264`). Keep an explicit decision about whether it belongs in agent or remains a v1 wrapper; it is not required for the no-store primary loop.

## 7. Existing tests and fake adapters

### Full-loop tests: scripted model, mostly real store

48 `*.spec.ts` files live directly in `/atlas/workspaces/atlas/packages/harness/src/loop/__tests__/`; all `.ts` test/fixture sources total 9,365 lines. The following are source-level coverage observations, not fresh pass claims.
- `/atlas/workspaces/atlas/packages/harness/src/loop/__tests__/run-turn.spec.ts:16-36,174,228,244-245,276-289`: normal multi-step loop/dispatch and built-in-style fake tool wiring, through buildHarness and temp home.
- `/atlas/workspaces/atlas/packages/harness/src/loop/__tests__/model-steps.spec.ts:57-74,120,144`: successive model/tool steps and record behavior, real JSONL log.
- `/atlas/workspaces/atlas/packages/harness/src/loop/__tests__/steerable-turn.ts:43-79,98-163`: reusable composer draft queue, model wrapper acting during a step, scripted model, no-op touch definition, memory registry, HookedToolDispatcher. **Still creates a temp home and real buildHarness**; this fixture underpins steering, retry-intake/log, wake-bookkeeping and other races.
- `/atlas/workspaces/atlas/packages/harness/src/loop/__tests__/hooked-turn.ts:8-12,50-58`: same real-store fixture family with configurable HookChain; before-turn/hook-phases specs.
- `/atlas/workspaces/atlas/packages/harness/src/loop/__tests__/settle-pending-fixture.ts:5,23` and `/atlas/workspaces/atlas/packages/harness/src/loop/__tests__/settle-parallel-fixture.ts:13,27`: fake tool dispatch/calls, real buildHarness; supports settle-pending, fresh-events, parallel and output specs.
- `/atlas/workspaces/atlas/packages/harness/src/loop/__tests__/context-reading.spec.ts:49-79,83-108`: context observer with card/window and no-op tool, real log.
- `/atlas/workspaces/atlas/packages/harness/src/loop/__tests__/retry-intake.spec.ts:49-104,106-142,145-158`: model throws first request; custom log append failure; reservation acknowledgment/release; backoff injection; verifies new input reaches retry prompt. Uses openSteerable → filesystem log.
- `/atlas/workspaces/atlas/packages/harness/src/loop/__tests__/retry-log.spec.ts:19-24,49-71,91-102`: fake operational LogPort and failing ModelPort, checks secret scrubbing; conversation event log still real.
- `/atlas/workspaces/atlas/packages/harness/src/loop/__tests__/turn-failed-event.spec.ts:41-68`: fake failing model, account provenance, persisted failure; real store via openSteerable.
- Other full-flow files in that same directory use buildHarness/temp home or one of the above fixtures: `auto-compaction.spec.ts`, `before-turn.spec.ts`, `builtin-turn.spec.ts`, `durable-input-turn.spec.ts`, `dynamic-tools.spec.ts`, `empty-step.spec.ts`, `ending-mid-request.spec.ts`, `environment-reminder-removal.spec.ts`, `finish-faults.spec.ts`, `hook-phases.spec.ts`, `interruption.spec.ts`, `loop-guard.spec.ts`, `loop-watchdog.spec.ts`, `model-switch-across-vendors.spec.ts`, `model-wait-turn.spec.ts`, `relocation-pause.spec.ts`, `resume-expansion.spec.ts`, `resume-interrupted.spec.ts`, `resume.spec.ts`, `retry-compaction.spec.ts`, `reused-call-id.spec.ts`, `say-expansion.spec.ts`, `shell-ending-wake.spec.ts`, `sleep-prevention.spec.ts`, `steering.spec.ts`, `turn-ledger-wiring.spec.ts`, `wake-bookkeeping.spec.ts`. The adjacent fixture `temp-home.ts:1-12` explicitly imports node fs/os/path and mkdtemp/removal.

### Already no-filesystem component tests/fakes

- `/atlas/workspaces/atlas/packages/harness/src/loop/__tests__/retrying-step.spec.ts:43-90`: direct fake `ScriptedModel extends ModelPort`, arrays capturing sleeps/logs/notices, injected jitter. Exercises retry engine without event store.
- `/atlas/workspaces/atlas/packages/harness/src/loop/__tests__/give-up-consultation.spec.ts:38-69`: AlwaysFailing ModelPort + no-op sleep/fixed jitter; tests fallback consult categories and budget without a store.
- `/atlas/workspaces/atlas/packages/harness/src/loop/__tests__/step-prepare-uploads.spec.ts:32-66,69-103`: stampDrafts fixture, fake upload placement port, spy rule, injected token count/compaction; tests preparation without a store.
- `/atlas/workspaces/atlas/packages/harness/src/loop/__tests__/prompt-on-model-switch.spec.ts:52-83`: direct core pipeline + in-memory prompt registry; no loop runner or filesystem.
- `/atlas/workspaces/atlas/packages/harness/src/loop/__tests__/operational-log.spec.ts:7,23,52`: dispatcher tests with in-memory registry; not full-loop record test.
- `pause-signal.spec.ts`, `upstream-http-retry.spec.ts`, `stream-retry-cadence.spec.ts` in the same directory directly test generic pause/retry behavior rather than starting buildHarness.
- `/atlas/workspaces/atlas/packages/harness/src/loop/__tests__/tldr-turn-runner.spec.ts:25-49`: local `inMemoryLog()` stamps and stores rows, implements read/readOwn/head/refresh/replace (replace is stub). At `:118-123` and subsequent cases, the inner runner is scripted, **not `LoopTurnRunner`**.
- `/atlas/workspaces/atlas/packages/harness/src/loop/__tests__/tldr-turn-runner-resume.spec.ts:20-69,73-89`: EmptyLog, FixedIds and PauseRecordingRunner, wrapper resume propagation only.
- `/atlas/workspaces/atlas/packages/harness/src/model/testing/scripted-model.ts:1-9,22-30,76-125`: shared `MockLanguageModelV4` + `simulateReadableStream`, provider stream parts for reasoning/text/calls/errors/finish/usage, captured SDK calls; no network/credential store. Good fake for integration through the real AI SDK adapter.
- `/atlas/workspaces/atlas/packages/harness/src/testing/root-unsafe.ts:1-18` is the **only current file** in top-level harness testing directory; it skips permission tests under root. It is not a shared in-memory harness/log/model adapter collection.
- Dispatcher `tools/__tests__/dispatch*.spec.ts` and core `assembly/__tests__` supply useful isolated coverage without needing a pod. They are not proof of no-filesystem full-loop execution.

### Distance to exit criterion

A minimal full-loop acceptance test can construct `LoopTurnRunner` directly with an in-memory stamping EventLogPort, deterministic IdPort, fixed launchDirectory, defaultPipeline(EMPTY_PROMPT), scripted ModelPort (or real AiSdkModelPort over scripted SDK model), and fake dispatcher/declarations. Omit spend/waitState/watch/cut/compaction/sleep-prevention capabilities initially, then add targeted tests for those injected seams. No pod/lease/thread-store constructor is needed in TurnDeps.

For a meaningful extraction test, exercise at least user input → model tool call → dispatch-start marker → result append → next model step → completed output, plus retry/new-intake and append-failure release. Do not satisfy the criterion using TldrTurnRunner with a fake inner or only `takeModelStepWithRetry`. Avoid importing the loop barrel into the new package test while it re-exports buildHarness; test the actual dependency entry point. No test was run here, so existing specs' current pass/fail status and runtime side effects of import evaluation remain unverified.

## 8. Rough size and candidate move boundary

Physical `wc -l` at this checkout; blank lines/comments included; counts are not a commitment to move every file.

| Production loop file under `/atlas/workspaces/atlas/packages/harness/src/loop/` |     Lines |
| ------------------------------------------------------------------------------- | --------: |
| build-harness.ts                                                                |       126 |
| close-quiet-step.ts                                                             |        89 |
| dispatch-recovery.ts                                                            |        47 |
| index.ts                                                                        |        12 |
| loop-guard.ts                                                                   |       131 |
| loop-watchdog.ts                                                                |       224 |
| model-step.ts                                                                   |        37 |
| pause-signal.ts                                                                 |        36 |
| pending-intake.ts                                                               |        54 |
| recorded-failures.ts                                                            |        53 |
| resume-turn.ts                                                                  |        28 |
| retrying-step.ts                                                                |       272 |
| run-turn.ts                                                                     |       293 |
| settle-pending.ts                                                               |       110 |
| shell-completion.ts                                                             |        22 |
| step-drafts.ts                                                                  |        41 |
| step-prepare.ts                                                                 |       158 |
| swallowed-outcome.ts                                                            |        26 |
| tldr-turn-runner.ts                                                             |       111 |
| tracked-turn-deps.ts                                                            |        14 |
| tracked-turn.ts                                                                 |       286 |
| turn-faults.ts                                                                  |        88 |
| turn-outcome.ts                                                                 |         1 |
| turn-policy.ts                                                                  |        29 |
| turn-position-state.ts                                                          |        37 |
| turn-position.ts                                                                |        84 |
| turn-runner.port.ts                                                             |        29 |
| waiting-outcome.ts                                                              |        23 |
| **28 production files**                                                         | **2,461** |

Useful sizing buckets outside that directory:
- Exclude concrete build root and optional footer wrapper from the initial loop body: **2,224 lines** remain (including barrel/policy/outcome declarations).
- Generic intake minus concrete source adapters: `message-intake.ts` 372 + `input-batch.ts` 21 + `retained-source.ts` 52 + `wait-for-input.ts` 18 = **463**. Include current `sources.ts` 42 + intake index 3 → intake directory **508**.
- Pending directory: pending-queue 226 + pending-queues 59 + user-said 12 + index 11 = **308**; includes command/edit wire vocabulary, so not automatically all agent-owned.
- Dispatch main implementation **292**; dispatch-drafts 88 + hook-silence 27 + tool-result-draft 31 → **438**. Registry adds 90; quality-dispatch adds 266. These optional quality/registry choices materially change a slice estimate.
- Generic HookChain 191 + budget 81 = **272**. Do not include builtin hook implementations by default.
- Main SDK adapter **251**, plus accumulator 116/chunk conversion 98/message conversion 124/tool-set 30/provider-prompt 13/instructions 12 = **744** before other conversion/provider-option/call-ID/wake helpers. Model directory overall is substantially larger than the port and main adapter; providers/OAuth/credentials are not synonymous with the loop model port.
- Retry-related adapter files: failure 146 + admission-blocked 65 + cause-chain 21 + errors 20 + turn-fault 13 + run-failure 55 + failure-diagnostics 19 + failure-provenance 45 + provider-error 107 + provider-reset 31 + network-failure 43 + safe-failure-message 17 = **582**, before credential-error/provider-key supporting vocabulary. Core retry/classification stays in core.
- Usage tally module adds **110** if moved; JSONL ledger is separate.
- Loop test/fixture subtree: **9,365 lines**, 48 spec files. Shared scripted SDK model: **125** more.

A plausible source-only first boundary is ~**4.0k lines**: 2,224 loop + 463 generic intake + 438 basic dispatch + 272 generic hooks + 582 fault adapter/vocabulary = 3,979, **before** SDK adapter conversion, prompt registry, pending queues, quality registry, usage accounting, tests or host-side v1 wrappers. This is sizing arithmetic, not a recommended all-at-once file move; the exact scope depends on which contracts stay in core, which SDK adapter modules remain in harness, and whether footer/policy wrappers remain host-side. Keeping ModelPort in core already avoids moving its definition.

## Suggested slice-spec checklist (derived seams; no changes made)

- Own ModelPort/TurnRunner/dispatcher/intake/outcome contracts below harness and client; choose explicitly which port contracts stay core versus agent.
- Leave buildHarness, store/lease/pod machinery, SDK credential resolution, execution adapters, concrete tool/hook implementations and source adapters outside agent.
- Move or isolate pure helpers currently housed in filesystem modules (`logFieldsOf`, ApplyLoopCut type), and model failure vocabulary currently tied to SDK/credential classes.
- Preserve all model retry/admission/cancellation/partial-output and fallback semantics; expose clock/random/sleep capabilities intentionally.
- Define a model-context snapshot seam that can meet L4 without rendering covered history; separately expose loop decision/dispatch state and bounded guard windows.
- Bridge v1 history-compacted events and v2 history-summarised/rewound record semantics without silently changing v1 assembly order or context survivorship.
- Unify input producers while retaining reserve → append → acknowledge/release and current child/main policy as configuration.
- Add a full-loop no-filesystem acceptance test, not just a component/wrapper test; retain existing v1 JSONL integration specs as behavior-regression coverage.
