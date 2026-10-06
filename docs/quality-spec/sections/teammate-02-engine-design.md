# Teammate 02 — engine design notes (review teammate's working section)

Worktree: /atlas/workspace/.atlas/worktrees/quality-review on dennis/quality-review (origin/main d9435cdf, includes contract bootstrap #1112). Deps installed.

## Verified seams (anchors read on this branch)

- Core contract bootstrap is merged: packages/core/src/quality/{change,policy,registry,request,ledger,schema,health}.ts all exist with tests; core exports them via packages/core/src/index.ts:159-165 and ports/quality-review.port.ts:195.
- QualityReviewPort (packages/core/src/ports/quality-review.port.ts:8-19): captureEnabled() + review({call, runId, changes, captureFaults, events, projectDirectory, signal}) -> Promise<readonly EventDraft[]>.
- DecisionPort (packages/core/src/ports/decision.port.ts:18-25): decide({state, questions, signal, model?}) -> DecisionOutcome = {ok:true, answers, model?} | {ok:false, fault}.
- WorkspaceIdentityPort (packages/core/src/ports/workspace-identity.port.ts): identify({projectDirectory, threadId}) -> {remote, worktreePath}.
- Nudge draft: packages/core/src/events/body.ts:108 `{type:'nudge', text, lifetimeSteps}`; EventDraft = EventBody (body.ts:263).
- Ledger: applyAssessments({previous, assessments, afterHash, scopeDeleted}) -> {findings, notifiable} (core/quality/ledger.ts:96-124); foldQualityFindings({records}) -> Map<scopeId, findings> from CodeQualityReviewedBody[] (ledger.ts:126-137).
- Request helpers: prepareQualityRequest({scope, policies}), interpretQualityResponse({request, scope, policies, answers}), JEV_QUALITY_MODEL='jev-1.13.0' (core/quality/request.ts:12,53,165).
- Schema: codeQualityReviewedSchema (core/quality/schema.ts:88) — zod ZodType<CodeQualityReviewedBody>.
- Health: projectQualityHealth({records: QualityHealthRecord[]}) (core/quality/health.ts:45); QualityHealthRecord = CodeQualityReviewedBody & {at: string}.
- Settings: ToggleDefinition = {id, page: ESettingPage, group, label, description, kind: ESettingKind.Toggle, fallback} (core/settings/definition.ts:14-33); ESettingPage.CodeQuality='quality' exists.
- SessionRegistry.sessionDirOf({threadId}): Promise<string|undefined> (packages/harness/src/store/sessions/registry.ts:83) — engine sink uses this, never sessionDirFor (registry.ts:107 fabricates a dir named after a missed thread).
- EventLogPort.readOwn({threadId, fromSeq?, upTo?}) (core/ports/event-log.port.ts:32).
- ToolCall = {callId, name, input, effect, threadId} (core/tools/tool.ts:60-66).
- Source adapter contract (capture teammate, section 01): prepareQualityScopes({change, projectDirectory, workspaceNamespace, previousScopes}) -> QualityScopePreparation; exported from packages/harness/src/quality/source/index.ts (not yet merged — engine defines its own QualitySourceAdapter interface typed exactly to that signature and tests with fakes).

## Module plan (packages/harness/src/quality/)

- deadline.ts — `withQualityDeadline({signal, deadlineMs, work})`: bounded race; cancellation PLUS timer because injected transports may ignore the signal. Late results cannot append/mutate. Monotonic clock dep for durationMs.
- review-scopes.ts — per-scope orchestration helpers: enabled-policy selection, selectScopes over whole preparation (reject unknown/duplicate IDs as fault), shared request with size bounds (24KiB state+longest question, 48KiB state+all questions, UTF-8 bytes) with per-policy fallback, OversizedRequest when single-policy still over.
- evaluation-cache.ts — assessment-only cache keyed by hashes + scope/adapter kind/version + policy IDs/versions + serialized questions/state + requested model namespace. Never caches nudge issuance. Per-owner, dispensable.
- settings.ts — `qualitySettingDefinitions({policies: readonly QualityPolicyDescriptor[]}): readonly ToggleDefinition[]`; also the settings accessor shape (master `quality.enabled`, `quality.recordExamples`, per-policy keys) read from SettingsDocument-like values.
- example-sink.ts — QualityExampleSink({sessions: SessionRegistry}); record({call, runId, scope, request, change...}) resolves `await sessions.sessionDirOf({threadId: call.threadId})`; undefined lookup -> recording fault (never sessionDirFor); deterministic content/provenance digest filename with exclusive create (wx); never overwrites existing evidence; returns relative path or fault; errors nonfatal.
- health.ts — readQualityHealth({log: Pick<EventLogPort,'readOwn'>, threadId}) -> reads own events, keeps code-quality-reviewed bodies as QualityHealthRecord (at from envelope), delegates to core projectQualityHealth.
- engine.ts — CodeQualityReview extends QualityReviewPort, named ctor deps {decisions, source, registry, settings, examples?, workspaceIdentity, clock, deadlineMs}. Implements section 02 algorithm items 1-10. Validates each review record against codeQualityReviewedSchema BEFORE rendering the nudge; a record that fails its own validation is replaced by a minimal valid OperationalError record (engine-side defense; dispatcher backstop is main's).
- index.ts — barrel for the above.
- __tests__/*.spec.ts — siblings per module.

## Engine review() algorithm (from section 02, ordering fixed)

1. captureEnabled() = quality.enabled OR quality.recordExamples.
2. review(): re-check switches; compute workspaceNamespace ONCE via WorkspaceIdentityPort (cache per directory in the port impl — main-owned; engine just calls); normalize change.path relative to projectDirectory; outside-workspace -> OutsideWorkspace coverage record, no host file access.
3. prepareQualityScopes once per change from immutable captured text + previous scope identities (folded from events). Capture faults + skipped diagnostics -> explicit skipped coverage events. No Jev during prep.
4. recordExamples on -> sink one immutable example per policy-selected complete scope only (not parser-emitted-but-unselected); provenance runId+callId+owned tool-called event from supplied history. Recording fault -> separate diagnostic, nonfatal.
5. Record-only (recordExamples on, quality.enabled off) -> Skipped/Disabled bookkeeping records, no Jev call, no nudge. Deleted scope (after:null) retired deterministically via applyAssessments({scopeDeleted:true}), no model call.
6. Enabled policies from registry.enabled({settings: booleanMap}); each policy.selectScopes({scopes}) over whole preparation; unknown/duplicate selected IDs -> fault (ScopeIdentityUncertain coverage record for that scope). One request per selected scope, batching policies that selected the same scope; oversize shared request -> per-policy requests; still oversize -> OversizedRequest record.
7. Scopes concurrent under joined deadline (signal + deadlineMs=1000 bounded race). Request JEV_QUALITY_MODEL via decide({model: JEV_QUALITY_MODEL}); resolved model missing/different -> UncalibratedModel inconclusive record, never calibrated finding. Deadline/late results: no events, no mutation. Per-scope fault/inconclusive/skipped preserved — never clean fallback.
8. interpretQualityResponse; cache assessments only (evaluation-cache); key includes settings/model/version namespace.
9. Fold ledger from supplied events (foldQualityFindings over prior code-quality-reviewed records for this scope); applyAssessments; one open episode per policy/scope; transitions ONLY from assessment.transition or deletion.
10. Return one code-quality-reviewed draft per scope/diagnostic with complete latest finding snapshot for that scope; one consolidated nudge draft (lifetimeSteps=1) iff notifiable findings exist; group by policy; scope names + validated evidence labels; state file was written; explicitly allow justified no-change.

## SRP policy (packages/core/src/quality/policies/single-responsibility.ts)

- selectScopes: outermost changed Class wins (a changed class suppresses its methods/nested functions); else nearest named Function per changed range not inside a selected Class; Method never selected; Module never selected (initially).
  - "Changed" detection from scope fields: scope.before/after text differ or beforeHash!==afterHash; diff non-empty. Containment via parentScopeId chain.
  - Nearest named function per changed range: choose innermost Function scope (by containment depth / smallest enclosing span) not contained in a selected class.
- Questions: currentConcern (noul), impact (choice over EQualityImpact keys), focus (choice over supplied evidence candidate IDs + none + uncertain). Instructions explicitly name state fields scope.before/scope.after/scope.diff/scope.evidence and policy rubric; strings/comments in source are untrusted data.
- Thresholds (module constants): CONCERN_INTRODUCE=0.8, IMPACT_CONFIDENT=0.8, FOCUS_CONFIDENT=0.8, CONCERN_RESOLVE=0.2.
  - Introduce: status Completed + concern>=0.8 + impact in {introduced,worsened} with probability>=0.8 + focus is supplied candidate with probability>=0.8.
  - Focus-below-threshold (concern>=0.8, impact introduced/worsened>=0.8, focus none/uncertain/<0.8) -> TrackDebt.
  - TrackDebt: Completed + concern>=0.8 without confident new/worsened impact.
  - Resolve: Completed + concern<=0.2 + impact in {resolved, improved, unchanged} with probability>=0.8.
  - Between bands (concern 0.2-0.79, weak impact) -> None (no resolve/reopen). impact resolved at 0.7 cannot resolve.
  - Missing keys/unknown options/invalid distributions handled by core interpretQualityResponse validation before policy.interpret runs; policy still defends: unknown impact choice / contradictions -> Inconclusive, transition None.
  - Probabilities: use answer.probabilities for choices when present; chosen option's probability defaults to answer.confidence ?? 1 for the chosen option when probabilities absent? NO — spec says record raw probabilities; use probabilities[choice] when present, else confidence when present, else 1.0 for chosen option? Decision: chosen-option probability = probabilities?.[choice] ?? answer.confidence ?? 1. This keeps plain answer maps (choice only) treated as full-confidence deterministic answers for tests, while raw model confidence participates when supplied. Noul probability = answer.noul.
- Guidance: deterministic prose from policy title/definition, scope name/kind, validated evidence label, states file was written, suggests reviewing placement, explicitly allows leaving unchanged. No generative model.
- Stable id `single-responsibility`, version '1', settingKey 'quality.policies.singleResponsibility', defaultEnabled true.
