# 02 — Advisory review execution, finding lifecycle and example collection

## Goal and teammate ownership
Review teammate owns `packages/harness/src/quality/` EXCEPT source/, plus initial core policy modules from section 04. Main owns the shared core contracts/lifecycle/event projection and cross-cutting root/dispatcher changes. The engine uses those contracts; it does not invent a separate ledger or hook phase.

## Existing source anchors
- packages/harness/src/tools/dispatch.ts:106-135 — successful invocation occurs before returned result/after-hook drafts; :284-293 explicitly keeps metadata out of public tool results.
- packages/harness/src/container/create-harness-container.ts:240-249 — shared dispatcher factory, main-owned injection.
- packages/harness/src/composition/compose.ts:85-87,142-156 — live settings, shared decision binding, stores/plugins and surface bindings before session machinery resolves.
- packages/harness/src/composition/compose-utility-models.ts:43-45 — reusable configured DecisionPort, no new provider client.
- packages/core/src/hooks/outcome.ts:20-25 vs events/nudges.ts:4-20 — permanent context vs finite draft; use nudge.
- packages/harness/src/loop/settle-pending.ts:68-94 — history snapshot currently stale across serial calls; main must refresh before each run while pending calls remain snapshotted.
- packages/core/src/events/body.ts:265-272 and compaction/watermark.ts:19-32 — preservation predicate controls destructive summary/rewind-floor correctness.
- packages/harness/src/store/sessions/registry.ts:83-109 — resolves/creates thread-scoped session directory, so example sink ownership follows call.threadId, not dispatcher registration time.
- packages/harness/src/store/sessions/thread-store.ts:290-305,318-344,364-384 — rewind/fork/summary behavior.
- packages/harness/src/store/sessions/paths.ts:72-79 — portable per-thread data location for opt-in immutable examples.
- packages/harness/src/cloud/session-archive.ts:47-70,101-110 — session artifacts already transfer; relative evidence paths, not machine-local /tmp references.
- packages/harness/src/channel/publishing-event-log.ts:7-10 and delta-channel.ts:92-94,193-214 — append precedes publication; main contains listener failures.

## Owned new modules
Create focused modules: quality/{engine,deadline,review-scopes,evaluation-cache,settings,example-sink,health,index}.ts and sibling tests. Source preparation is imported from the capture teammate's source/index.ts. Policy registration returns pure registry/descriptors; main root performs the actual container/settings registration. Avoid files >300 lines, decorator DI, broad barrel imports in the eval leaf, or operational mutable singletons outside the shared root.

Required public exports:
- `CodeQualityReview extends QualityReviewPort` with named constructor dependencies: DecisionPort, source adapter, policy registry, settings accessor, optional example sink, monotonic clock, and deadline policy. No event-log dependency; events are supplied fresh by the dispatcher.
- `qualitySettingDefinitions({policies: readonly QualityPolicyDescriptor[]}): readonly ToggleDefinition[]` creates policy rows (stable settingKey/title/description/defaultEnabled); master/recordExamples are main-owned definitions.
- `readQualityHealth({log: Pick<EventLogPort,'readOwn'>,threadId}): Promise<QualityHealth>` delegates to core projection, no local-root closure.
- `QualityExampleSink` constructed with `sessions: SessionRegistry`; its write method takes `call.threadId` and calls `await sessions.sessionDirOf({threadId})` — NOT sessionDirFor, whose fallback fabricates a session directory named after a missed thread (registry.ts:107-110). An undefined lookup records a recording fault instead of writing to a made-up folder. Test fake accepts complete snapshot and returns relative path or recording fault. Never bind to parent/root thread at registration.

## Review algorithm (exact ordering)
1. `captureEnabled()` returns true if quality.enabled OR quality.recordExamples. OFF+no collection means current write behavior unchanged.
2. `review()` checks current switches, computes the workspace namespace ONCE through the injected WorkspaceIdentityPort (section 00; git probes run on the thread's execution backend, results cached per directory and invalidated on relocation), and normalizes the source path relative to the supplied projectDirectory. Reject outside-workspace paths rather than accessing host/source files again. Event history is used for the finding ledger, not path-derived identity.
3. Prepare before/after scopes once from captured immutable text and previous scope identities. Source adapter returns all changed enclosing scopes with parent relationships. Capture faults and unsupported/invalid/oversized scopes produce explicit skipped coverage events. Parsing does not call Jev.
4. When recordExamples enabled, write an immutable raw input example for each complete policy-selected scope, with schema/adapter version, workspace-relative path, exact before/after/diff/relevant context, hashes, tool/run/thread/call-occurrence provenance and target schema. Do not write raw text for merely parser-emitted scopes that no applicable policy judges; coverage remains event-recorded. Source occurrence is located by runId+callId+owned call event in supplied history; never bare callId across a corpus. Filename uses a deterministic content/provenance digest with exclusive creation/verification; repeated identical capture does not overwrite existing evidence. No expected outputs or historical agent rationales become reference labels here. Recording error is separately diagnosed, never changes successful write or a valid model assessment.
5. Record-only mode emits skipped/disabled review bookkeeping where appropriate, no Jev call/nudge. Deleted scope can be retired deterministically and is not a model-quality eval observation.
6. Select enabled policies by current descriptor setting keys, then ask each policy to selectScopes over the whole preparation. The engine builds one request per selected scope, batching only policies that selected the same scope. Each policy's questions are independent; never one policy-name Choice or a giant multi-class state. If a shared request exceeds the size bound, fall back to per-policy requests for that scope before ever recording skipped coverage.
7. Execute scopes concurrently under the dispatcher-supplied 1000ms joined deadline/turn signal. Source preparation is input-size-bounded and measured; this is not a hard real-time CPU guarantee. Request the pinned JEV_QUALITY_MODEL (section 00) through DecisionPort's optional model argument; missing/different resolved model identity is recorded uncalibrated/inconclusive, never an automatically accepted calibrated finding. Jev provider zero retries; no utility/generative fallback. Use cancellation PLUS a bounded race because injected transports may ignore the signal. Deadline/late results cannot append, mutate state or create nudges after review returns. Preserve per-scope fault/inconclusive/skipped outcomes, not a clean fallback.
8. Validate required answers and interpret via the same core helpers used by evals. Assessment cache key: hashes + scope/adapter kind/version + policy IDs/versions + exact serialized questions/state + requested model/config namespace. Cache ASSESSMENTS only; never cache nudge issuance. Cache is per execution owner and dispensable, not authority; settings/model/version changes invalidate keys. Live evals disable it.
9. Fold ledger from supplied composed raw events, including inherited prefix; never assume a prior in-memory map survived rewind/restart/lift. Apply pure per-policy/scope episode transitions driven ONLY by the assessment's `transition` field (None/Introduce/TrackDebt/Resolve — set by the policy, section 00) or actual scope deletion. One tracked open episode per policy/scope initially; evidence change alone cannot recursively notify. Unchanged/improved/uncertain/fault do not repeat nudges. Later verified introduction starts a new episode. Preserved last snapshots make this reconstructable after summary.
10. Return self-contained code-quality-reviewed draft per scope/file diagnostic, with complete latest finding snapshot for that scope, assessments, statuses, hashes, versions, timing and optional evidence reference. Render one consolidated finite nudge per call for actually new episodes. Group by policy, use scope names and validated evidence labels, state file was written, and explicitly allow justified no-change. No permanent context-loaded instruction, automatic follow-up turn, rollback or write denial.

## Main-owned dispatcher integration requirements
Add optional `quality?: QualityReviewPort` constructor dependency at dispatch.ts:67-79. Pass captureFileChanges into invokeTool -> ToolInvocation only when port.captureEnabled() is true. After successful invocation, call review outside tool write lock and outside invokeTool's catch. Pass actual allowed ToolCall, source runId, fresh raw events, changes/faults, directory and joined cancellation. Return original tool-result first, then quality review drafts/consolidated nudge, then ordinary after-hook drafts. Root/container creates the same quality implementation for main/sub/teammate/serve sessions. Runtime faults must be contained and logged without replacing original result.

Refresh `settle-pending.ts` history at the start of EACH partitioned run (not a new pending-call computation); pass that run's refreshed events to dispatched calls. Write runs are singletons, so the second serial write sees the first durable finding and does not duplicate its nudge. Read-only batch semantics remain unchanged.

Success is physically committed before quality inference, but current result logging waits for bounded review. Do not claim early-published success or filesystem/log atomicity. Crash after rename/before append is an existing harness gap, not solved by this feature. The review port has no hidden log append; normal writer publishes its drafts in order.

## Durable state tests main and review teammate coordinate
- A first introduced concern -> one event+nudge; correcting edit unchanged -> event only; improving -> event only; clear -> resolved; genuine reintro -> new episode+nudge.
- Focus selection changes while concern remains -> still same episode, no new nudge.
- First existing debt with unchanged edit -> tracked but unnotified; later actual worsening can notify once.
- Two policies -> independent findings; separate scopes -> independent episodes.
- Duplicate dispatch/call event or cached assessment -> ledger-aware dedupe; no notification cache.
- Two serial writes in one model step use fresh events; append failure does not pre-mark notified.
- Child/teammate thread example writes land in the child's thread data directory; a dispatcher registration-time directory is rejected by tests.
- Lift and descend tests retain logical namespace and do not create new episodes, including arrival batches with location-changed followed by directory/worktree events.
- Dispatcher returns original result despite malformed generated quality drafts: validation replaces malformed records with bounded OperationalError and does not make log append reject the tool result.
- Regular compact/destructive summary preserves self-contained finding state and watermark rules, while finite nudge leaves prompt.
- Reopen, copy/reference fork and lift archive reconstruct ledger; paths do not change finding identity solely on location change.
- Rewind drops conversational decisions above cut without restoring files; next actual capture reevaluates differing hashes. No quality event in physical-process reappend list.
- Parser fault/missing scopes/provider timeout/low confidence never silently resolves debt or reports passed.
- Example recording off -> no raw-source artifact; on -> complete versioned relative-path file, no expected-label leakage, immutable collision/replay verification, recording fault nonfatal, archive portability.

## Validation commands
From packages/harness: `bun run typecheck`; `bun run test src/quality/__tests__ src/tools/__tests__/dispatch.spec.ts src/tools/__tests__/dispatch-budget.spec.ts`.
Main runs core ledger/schema/summary tests and harness settle/channel/session archive suites under standard preload. Exact existing test filenames are listed in evidence/runtime-seams.md:96-110; do not bypass ATLAS_TESTING or the scratch-home preload.

## Acceptance and non-goals
No model-backed check can turn a successful write into failure. OFF is current behavior. Review is bounded and happens in the runtime owning the file, not the TUI. No background reviewer scheduler, model-generated explanation, third-party policy loader, shell attribution, global cross-thread dedupe or automatic repair loop. Compact bookkeeping may survive summaries; raw example retention is opt-in, session-local and not authoritative.
