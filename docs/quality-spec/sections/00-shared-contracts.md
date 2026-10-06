# 00 — Shared contracts and main-session ownership

## Goal
Freeze the seams that independently implemented runtime capture, review execution, policies, settings and shared evals consume. Main/integration owns these contracts and cross-cutting existing-file edits. The definitions below are the implementation baseline; the final spec review may correct internal inconsistencies before handoff.

## Read evidence
- packages/core/src/tools/tool.ts:58-75 — ToolCall and ToolOutcome; successful outcomes have structured output plus modelText, no typed source-change payload.
- packages/core/src/tools/tool.ts:146-210 — invocation/run forwarding and SchemaTool.
- packages/core/src/ports/agent-filesystem.port.ts:4-46 and its Local/Docker/Routed implementations — main adds one backend-owned `readTextForEdit({path,threadId}): Promise<{text: string; strict: string | null}>` method: one byte read, `text` = that backend's existing lossy decode, `strict` = fatal-decode result or null. Tools never choose decoders; backends own their decoding behavior. (local-filesystem.ts:26-32, docker-filesystem.ts:20,100-101, routed-filesystem.ts:34-40.)
- packages/harness/src/store/sessions/lines.ts:90-98 and store/sessions/event-log.ts:151-176 — durable append validates every draft and can otherwise fail the whole batch. Dispatcher therefore validates/sanitizes quality drafts before returning them.
- packages/harness/src/cloud/relocation/workspace-arrival.ts:35-63 — lift emits location/directory/worktree markers together; namespace uses logical repo/worktree identity, not arrival paths.
- packages/harness/src/execution/local-filesystem.ts:26-32 and docker/docker-filesystem.ts:100-110 — lossy readFile versus available readBytes; capture uses strict decoding.
- packages/harness/src/store/sessions/registry.ts:83-109 — sessionDirOf resolves a thread's session directory for the per-thread example sink; the sessionDirFor fallback must not be used.
- packages/core/src/ports/decision.port.ts:1-22 — current bounded questions, string state, answers without confidence.
- packages/core/src/policy/classifier/jev.ts:81-91 — shared response schema discards confidence and model identity.
- packages/harness/src/classifier/jev-client.ts:14-23,61-80 — current request shape, 2-second default, zero retries, signal forwarding, returned faults.
- packages/core/src/events/body.ts:92-107 and schema.ts:123-158 — success results, logged context, finite nudges.
- packages/core/src/events/nudges.ts:4-20 — nudge lifetime counts assistant-said events.
- packages/core/src/assembly/rules/messages-from-events.ts:73-80 — modelText separate from structured/UI output.
- packages/core/src/index.ts:118-120,132-158,165-191 — central exports (main ownership).
- packages/core/package.json:9-18 — Bun tests, zod-only runtime dependencies.
- docs/architecture.md:1544-1561 — pure core/shared root and package criteria.

## Proposed concrete contracts

### Captured source change
New `packages/core/src/quality/change.ts` owns pure types, not parser implementations.

```ts
export enum EQualityLanguage { TypeScript = 'typescript', JavaScript = 'javascript' }
export enum EQualityScopeKind { Module = 'module', Class = 'class', Method = 'method', Function = 'function' }
export type CapturedFileChange = {
  path: string
  before: string | null
  after: string
}
export type QualityEvidence = {
  id: string
  label: string
  changed: boolean
}
export type QualityScopeIdentity = {
  id: string
  workspaceNamespace: string
  path: string
  language: EQualityLanguage
  kind: EQualityScopeKind
  name: string
  adapterVersion: string
  structuralHash: string
  parentScopeId: string | null
  lineRange: { start: number; end: number } | null
}
export type QualityScope = QualityScopeIdentity & {
  before: string | null
  after: string | null
  diff: string
  beforeHash: string | null
  afterHash: string | null
  evidence: readonly QualityEvidence[]
  dependencyContext: readonly string[]
  beforeLineRange: { start: number; end: number } | null
  afterLineRange: { start: number; end: number } | null
}
export type QualityScopePreparation = {
  scopes: readonly QualityScope[]
  skipped: readonly QualityCoverageDiagnostic[]
}
```
`path` is capture-time absolute; the engine stamps thread/run provenance, computes project-relative path and workspace namespace, and passes them to the parser. Tools fill only path/before/after — ToolRun carries no events, so tools cannot compute namespaces. Hashing, scope IDs and source parsing are harness I/O/adapter work; pure code consumes them. Null-before means creation; null-after on a scope means deletion, not parse failure. Unsupported or invalid source is a typed coverage outcome, never a clean review.

Add `fileChanges?: readonly CapturedFileChange[]` and `fileChangeFaults?: readonly QualityCoverageDiagnostic[]` to successful ToolOutcome. These are dispatcher-only metadata and must NOT be copied into generic tool-result output or sent wholesale to the agent. Add optional `captureFileChanges?: boolean` to ToolInvocation/ToolRun and forward it in SchemaTool.invoke. Absent/false is byte-compatible OFF behavior and performs no extra read. Main dispatcher passes `quality?.captureEnabled() === true`; the runtime engine checks current settings again before review. Capture happens inside the existing write serialization, never a separate before hook. For overwrite, inability to read old contents must not prevent the original write: return a capture fault alongside the successful outcome and record skipped coverage. Null-before only means actual creation, not unreadable old content. Edit/multi_edit capture reads bytes strictly when capture is on; see section 01 for on/off parity.

### Policy contract and interpretation
New `packages/core/src/quality/policy.ts`, `assessment.ts`, `registry.ts`.

```ts
export enum EQualityImpact {
  Introduced = 'introduced', Worsened = 'worsened', Improved = 'improved',
  Resolved = 'resolved', Unchanged = 'unchanged', NotApplicable = 'not_applicable',
  Uncertain = 'uncertain'
}
export type QualityPolicyDescriptor = {
  id: string
  version: string
  title: string
  description: string
  settingKey: string
  defaultEnabled: boolean
}
export type QualityPolicy = QualityPolicyDescriptor & {
  definition: string
  exceptions: readonly string[]
  selectScopes(args: { scopes: readonly QualityScope[] }): readonly string[]
  questions(args: { scope: QualityScope }): Record<string, DecisionQuestion>
  interpret(args: {
    scope: QualityScope
    answers: Readonly<Record<string, DecisionAnswer>>
  }): QualityAssessment
  guidance(args: { assessment: QualityAssessment; scope: QualityScope }): string
}
```
`QualityAssessment` is `{policyId:string,policyVersion:string,scopeId:string,status:EQualityReviewStatus,impact:EQualityImpact,currentConcernProbability:number|null,transition:EQualityTransition,evidenceIds:readonly string[],rawAnswers:Readonly<Record<string,DecisionAnswer>>,detail?:string}`. `EQualityTransition` is `{None, Introduce, TrackDebt, Resolve}` — set ONLY by the policy's interpret function from its own thresholds, so the shared ledger acts on `transition` and never re-encodes any policy's numeric bands. The engine rejects unknown/duplicate IDs returned by selectScopes as a fault rather than silently dropping them, and retires a deleted scope (after:null) regardless of whether any policy selected it. Status values: Completed, Skipped, Inconclusive, OperationalError. Missing requested answers, invalid options, contradictions or insufficient certainty produce Uncertain/inconclusive; no passing fallback. `QualityCoverageDiagnostic` is `{path:string, reason:EQualitySkipReason, detail?:string}`; reasons are UnsupportedLanguage, DeclarationOnly, OutsideWorkspace, SourceUnavailable, InvalidText, InvalidSyntax, OversizedSource, NoSupportedScope, ScopeIdentityUncertain, Disabled, DecisionUnavailable, UncalibratedModel, OversizedRequest, ReviewDeadline, TurnInterrupted, WorkspaceUnidentified. `QualityScopePreparation` contains readonly scopes and skipped diagnostics.

Policies remain pure values/functions. Registry validates unique policy IDs and setting keys, deterministic order and enabled policy IDs; expose descriptors separately from executable definitions. No abstract inheritance hierarchy, per-policy model clients or new general plugin loader. `selectScopes` is the policy-owned scope filter over the whole preparation (the parser emits every changed enclosing scope and performs no selection); the engine prepares one request per selected scope, batching only policies that select the same scope. A shared multi-policy request that exceeds the request-size bound falls back to per-policy requests before ever skipping coverage. `prepareQualityRequest({scope,policies})` in core quality/request.ts returns `QualityDecisionRequest={state:string,questions:Record<string,DecisionQuestion>,bindings:Record<string,{policyId:string,questionKey:string}>,policyVersions:Record<string,string>}`. It prepares named JSON with scope before/after/diff/dependencyContext/evidence and per-policy definition/exceptions, prefixes question IDs and includes exact reverse bindings. `interpretQualityResponse({request,scope,policies,answers})` returns readonly QualityAssessment[] using those same mappings in production and evals. Reject a Choice with >255 options before any request; never silently shortlist evidence or omit policies. Fan out independent questions for ONE prepared semantic scope. IDs alone are not visible to Jev: instructions must name before/after/diff/policy state explicitly.

### Decision response compatibility
Extend optional `confidence?: number` on DecisionAnswer and response schema with a [0,1] bound. Add optional resolved `model?: string` on successful DecisionOutcome and response schema; historical/provider fixtures without either remain valid. Keep `state: string` and existing string question descriptions for initial implementation, serializing named JSON context once. This uses TypeSafe's capabilities without forcing unrelated callers to migrate.

Add optional `model?: string` to DecisionPort.decide args and JevDecisionClientDeps; request priority is args.model ?? deps.model ?? JEV_MODEL. Existing callers remain alias-based and byte-compatible by default. Define `JEV_QUALITY_MODEL = 'jev-1.13.0'` in core quality/request.ts and use it in production review and eval defaults from one source. This validated policy is not silently moved by jev-latest; eval runs on another requested model are recorded as not promotable. Record requested and returned models in artifacts; differing/unknown model identity is not a calibrated success claim. Preserve provider 2-second timeout/zero-retry default while the quality caller supplies its joined 1000ms review deadline. No generative fallback. TypeSafe source: https://docs.typesafe.ai/models.md, read 2026-10-06.

### Review execution seam
New core `ports/quality-review.port.ts`:

```ts
export abstract class QualityReviewPort {
  abstract captureEnabled(): boolean
  abstract review(args: {
    call: ToolCall
    runId: RunId
    changes: readonly CapturedFileChange[]
    captureFaults: readonly QualityCoverageDiagnostic[]
    events: readonly Event[]
    projectDirectory: string
    signal: AbortSignal
  }): Promise<readonly EventDraft[]>
}
```
Main wiring invokes this after successful tool invocation with changes/capture faults. Engine owns source scope selection, model calls, timeout handling and finding lifecycle. Return drafts only; dispatcher/turn writer publishes them. The port performs no direct log append or mutable-ledger update; opt-in immutable example artifacts are supplementary evidence, not operational authority. Never mutate successful output into failure. Success becomes durable only after the bounded review returns in the current one-batch settlement; this is not early publication and not a filesystem/log transaction.

### Durable finding state and review event
New `quality/finding.ts`, `ledger.ts`, `event.ts`, `schema.ts`, `health.ts` define deterministic lifecycle and the `code-quality-reviewed` event arm. New enums: `EQualityReviewStatus` (Completed/Skipped/Inconclusive/OperationalError), `EQualityFindingState` (Active/Resolved), plus skip reasons above.

`QualityFinding` is `{id,policyId,scopeId,episode,state,notified,lastAfterHash,policyVersion}` with strings except episode:number, notified:boolean, state:enum, lastAfterHash:string|null. Initial release deliberately tracks ONE open episode per policy+scope. Evidence enriches the finding but is not its identity: moving or changing the selected focus must not create recursive nudges. New policy/scope can notify separately; a genuinely reintroduced concern after confident resolution starts another episode. This conservative tradeoff prevents recursion without pretending to distinguish every semantic issue instance.

Ledger transition table (main-owned, applied exactly):
| Current state | Transition | Result |
|---|---|---|
| none / Resolved | Introduce | new episode, nudge |
| none / Resolved | TrackDebt | new episode, not notified |
| Active, not notified | Introduce | mark notified, nudge once |
| Active, not notified | TrackDebt | silent update |
| Active, notified | Introduce or TrackDebt | silent update |
| existing finding | Resolve or scope deletion | Resolved |
| no finding | Resolve | no-op — no finding is created from nothing |
| any | None | no change |
Focus-below-threshold (concern/impact confident but focus none/uncertain or under 0.8) maps to TrackDebt: no validated evidence label, no nudge.

`CodeQualityReviewedBody` is `{type:'code-quality-reviewed',callId,workspaceNamespace,path,scope?:QualityScopeIdentity,beforeHash:string|null,afterHash:string|null,status:EQualityReviewStatus,reason?:EQualitySkipReason,detail?:string,assessments:readonly QualityAssessment[],findings:readonly QualityFinding[],durationMs:number,requestedModel?:string,resolvedModel?:string,evidencePath?:string}`. Findings are the complete current snapshot for THIS scope (all previously known policy entries included), not the whole thread. File-level skipped records have no scope/findings. Do not store raw source in this retained bookkeeping event. Runtime publisher stamps standard envelope IDs/time/run provenance. The ENGINE validates its own review records against core's event-body schema BEFORE rendering the nudge, because only the engine holds scope/policy context needed to re-render it. The dispatcher's backstop is then all-or-nothing: if any returned quality draft still fails validation, it drops ALL quality records and the nudge, substitutes one minimal OperationalError record that is valid by construction, logs the defect, and keeps the tool result. A malformed review draft can never make the durable append reject the successful tool-result draft; the accepted 'missing delivery is not a fault' rule covers the dropped nudge. Original tool result remains authoritative.

Append one review event per reviewed/failed/skipped scope, followed by a single consolidated `nudge` for the call only if newly notifiable episodes exist. `lifetimeSteps=1`; no context-loaded quality instruction, no persistent warning in prompt, no auto-wake/repair turn. The event includes notification-issued flags as a projection of the paired nudge decision; both drafts append in the same ordered batch. A rewind may deliberately cut after review and before nudge; missing delivery must not be treated as a new model fault or auto-repaired. Do not mutate a ledger before append succeeds.

The event log remains the only operational authority. Fold from fresh composed raw events (including inherited fork prefix), selecting latest scope snapshots. IDs never equal source hashes/line numbers or policy versions; hashes key an in-memory evaluation cache only. OFF/uncertain/fault/skipped outcomes never close/reopen existing findings. Resolution happens only through an assessment whose `transition` is Resolve (policy-defined rule, section 04), or actual scope deletion; OFF/uncertain/fault/skipped outcomes never resolve. Cache entries contain assessments, not generated nudges, and are re-run through current ledger logic.

Add code-quality-reviewed to `SURVIVES_SUMMARY` at packages/core/src/events/body.ts:265-272. It survives destructive summary and ordinary reopening without becoming model/summarizer/transcript speech. Keep it unrendered in messages-from-events/compaction prose; shared survivesSummary predicate automatically supports watermark correctness (compaction/watermark.ts:19-32). Rewind removes events above its cut under existing semantics, with no filesystem restoration. Do not reappend quality records as physical-process notices. Missing review after a successful write is unreviewed, never clean.

Workspace namespace is computed once per review by the engine via a NEW main-owned port, never by tools and never from event paths: `WorkspaceIdentityPort.identify({projectDirectory, threadId}): Promise<{remote: string|null, worktreePath: string|null}>`, running git probes through the thread's execution backend (Docker git ≠ host git). Results are cached per directory and invalidated on relocation events; a probe timeout yields a ReviewDeadline-style OperationalError record rather than an invented identity. Namespace = normalized remote URL when present, else `local:` + the repository's root commit SHA (lexicographically smallest of `rev-list --max-parents=0` when a repo has several roots; shallow clones without any root commit produce a WorkspaceUnidentified coverage record rather than an invented identity; path-independent since lift preserves history), plus worktree separation by branch + path relative to the repository root — never a bare branch, so detached 'HEAD' worktrees (workspace-arrival.ts:49) do not collide. Known limits, recorded explicitly rather than mapped: suffixed restore renames (restore-apply.ts:120) and mid-thread branch switches change the worktree component; renamedFrom exists only in free-text context-loaded notices, so no mapping is attempted. These produce a new namespace and a possible new episode — acceptable, bounded, and documented rather than merged wrongly. Two repositories never share a namespace; no global cross-thread dedupe guarantee; stale hashes after rewind are not current-disk certificates.

`QualityHealth` projection uses own events for UI: latest recorded outcome/path/scope/policies/timestamp, not current endpoint health. It distinguishes no review from skipped/inconclusive/fault and explicitly labels last recorded evidence.

## Settings and initial implementation defaults
Main adds ESettingPage.CodeQuality (`quality`) and its `Code Quality` page descriptor. Initial master setting `quality.enabled=false`; SRP descriptor key `quality.policies.singleResponsibility=true` is inert while master off. `quality.recordExamples=false` is a separate explicit local collection toggle. A policy module owns its stable settingKey/defaultEnabled; descriptors generate boolean rows dynamically at startup, no UI edits per added policy. Master remains present with zero policies. Runtime policy unloading/replacement is out of scope.

`captureEnabled()` is master enabled OR example collection enabled. Record-only mode captures/prepares immutable examples without a Jev call or policy nudge. Raw source artifacts only exist when collection is explicitly enabled, under `threadDataDirectory/quality/examples/`, and carry capture provenance, complete prepared scope, policy/adapter/schema versions and hashes, with no expected labels. The sink is optional, I/O-fallible and cannot change write/model success. Artifacts are local/session-portable, not automatically uploaded or committed; public corpus requires curation/redaction/verification.

Proposed bounds: source file <=1 MiB. Request size is gated when the request is built: serialized state+longest question <=24 KiB and state+all questions <=48 KiB (UTF-8 bytes, conservative margins below the pinned model's published 64k-token total and 32k state+longest-question budgets, because before+after+diff repeat text; not an exact tokenizer). A shared multi-policy request over the combined bound falls back to per-policy requests before skipping; a single-policy request still over bound records OversizedRequest. No truncation. Runtime review deadline 1000ms awaited async review budget per tool call, combined with turn cancellation; synchronous parsing is size-bounded and separately measured, not a hard real-time guarantee. Parsing, request and interpretation timings measured separately. These are responsiveness/supported-input bounds, not cost optimization or a promised p95. Requests for independent scopes may execute concurrently under this single deadline; late completion cannot emit new events or mutate authority. Runtime retains Jev's existing zero retry and no generative fallback. Eval mode records cold/warm timing and disables request caches for repeated trials.

## Main-owned hot spots
Only main/integration edits core exports/types/registry/request helpers/lifecycle/event schema/health projection, shared DecisionAnswer/schema/client additions, AgentFileSystemPort + Local/Docker/Routed implementations (readTextForEdit), WorkspaceIdentityPort, EventBody and exhaustive consumers/SURVIVES_SUMMARY, ToolOutcome/Invocation forwarding, dispatcher QualityReviewPort seam, settle-pending fresh-events logic, publication failure containment, shared root/container registration, core settings enums/pages, harness exports, root/harness manifests and lock (plus initial eval workspace skeleton), wire protocol version, and architecture documentation. Eval teammate owns evals/package.json after bootstrap. Teammates write their owned new modules and narrowly named existing tool/UI files; main imports/wires them after contracts land. The source teammate owns quality/source; the review teammate owns quality engine/policies/settings adapter/example sink/health reader; eval teammate owns evals/; surface teammate owns new TUI quality health UI and named settings/component plumbing.

## Validation
- `bun run typecheck` and `bun run test` in packages/core with the repository's test-home conventions.
- Existing Jev fixtures without new fields still decode; invalid confidence is rejected; resolved model preserved; default requests stay byte-compatible except optional request model override.
- Pure registry/interpretation/lifecycle tests cover missing/duplicate IDs, uncertain answers, independent multi-policy decisions, new/improved/unchanged/resolved/reintroduced concerns and duplicate calls.
- Historical event fixtures continue parsing; tool output/modelText does not expose raw fileChanges.

## Parallel readiness
This contract must be finalized and delivered in a small contract commit before implementation teammates start coding against it. Contract owner is main; other workstreams may plan concurrently but may not improvise different shapes.
