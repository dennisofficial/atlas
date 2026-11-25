# 06 — Optional: one pre-approved alternate

Status: OPTIONAL FINAL slice, buildable spec against `eeee3e7ef`; planning only. Shared authority is `$ATLAS_CONTEXT_DIR/contracts.md`: this slice reuses its exact admission/probe-promotion lifecycle and05's immutable actual-route accounting;03's private per-attempt receipt is never stored in audit events. Ship01–05 without it. This is one alternate bound to an explicit finite consent record, not a routing graph, provider-priority list or autonomous optimizer.

## Delivered behavior and limits

The operator may approve **one concrete alternate** for an explicitly listed main/children/utility-call scope in this session family. When a covered selected route becomes unavailable, try that alternate at the next safe model boundary, at most one route hop. If alternate is unavailable, incompatible, stale, disallowed or fails after its bounded permitted attempts, remain Waiting for model and offer05. Do not return to primary when it recovers, select a third route, recursively use the alternate's own alternate, or grant consent to new descendants/settings by implication.

There is no account-wide/global fallback preference and no fallback on a normal model choice by default. Approval is separate from05's immediate switch; a one-off recovery never silently becomes standing alternate consent. The feature is not complete if it merely adds a wrapper around one UI's model.

## Evidence and required replacement, not another wrapper

Paths relative to `/atlas/workspaces/atlas`.
- `packages/harness/src/composition/child-fallback-model.ts:67–118` currently flips to parent immediately on dead credentials, and lazily follows the parent's later selection. `composition/child-model.ts:106–145` binds it. That is existing legacy helper behavior, not consent to a new main alternate. Preserve narrowly bounded helper→eligible current-session behavior through01–05;06 replaces its implementation only when equivalent gated recovery and truthful identity ship together. Never nest legacy and approved alternates to obtain two hops.
- `packages/harness/src/loop/run-turn.ts:45–55,149–176` structurally detects `switch()` and hands it to retry; `loop/retrying-step.ts:182–193` can reset attempt count on give-up without re-preparing for the new provider. Remove this structural fallback switch contract and its budget reset; typed routing owns the single hop.
- `packages/harness/src/composition/utility-model.ts:48–108,113–125` separately builds/caches helper providers, falls back to the session model and exposes mutable getters. All roles must cross the same gate and consent resolver. The actual finite roles are `EUtilityModelRole.Tldr`, `Titler`, `Judge`, `Compaction` at `packages/core/src/models/utility-roles.ts:6–11`; explicit overrides resolve at `:34–45`.
- `packages/harness/src/model/fallback-model.ts:98–148` catches broad generation errors and restarts streams; its `provider/modelId` getters remain primary (`:114–123`) after fallback answers. Its restartable stream avoids emitted output (`:67–85`) but carries no per-attempt identity/usage.05 fixes step identity/usage propagation through the immutable route handle;06 consumes that handle and must not rebuild attribution.
- `packages/harness/src/model/ai-sdk-model-port.ts:129–137` already disables hidden SDK retries. Keep it so all attempts enter shared admission.
- Per-route ledger correctness and immutable identity are05 prerequisites: `record-turn-spend.ts` gains additive `routeSpends` segments keyed on the identity the answering port stamped; Jsonl/remote ledger, wire turn schemas, API Turn `routeSpends` JSON column and UI segment pricing all ship in05.06 reuses them; this slice adds only consent-scope + one-hop attribution on top. Core `ports/model.port.ts:13–18,33–43` gains the stamped identity on ModelStepResult in05;06 adds the audit receipt/attempt events, never a parallel identity channel.

## Consent and route decision contracts

New core `model-recovery/alternate.ts` and `models/model-attempt.ts`. Reuse05 `EffectiveModelRoute`, origin and warning contracts,02 normalized failure/admission,03 authority revisions. No new account store.

```ts
export enum EModelCallKind {
  Main = 'main',
  Child = 'child',
  Utility = 'utility',
}
export type ApprovedCallSite =
  | { kind: EModelCallKind.Main; threadId: ThreadId }
  | { kind: EModelCallKind.Child; threadId: ThreadId; explicitRetarget: boolean }
  | { kind: EModelCallKind.Utility; ownerThreadId: ThreadId; role: EUtilityModelRole }
export type AlternateConsent = {
  consentId: string
  generation: number
  rootThreadId: ThreadId
  alternate: EffectiveModelRoute
  sites: readonly {
    site: ApprovedCallSite
    primaryRoute: EffectiveModelRoute
    selectedOrigin: EModelSelectionOrigin
  }[]
  acceptedWarningIds: readonly string[]
  approvedAt: string
}
export enum EAlternateDecision {
  Stay = 'stay',
  Switch = 'switch',
  Wait = 'wait',
}
export type AlternateDecision = {
  decision: EAlternateDecision
  route: EffectiveModelRoute | null
  consentId: string | null
  reason: string
}
export enum EModelAttemptOutcome {
  Completed = 'completed',
  Rejected = 'rejected',
  Failed = 'failed',
  Partial = 'partial',
}
export type ModelAttemptReceipt = {
  attemptId: string
  threadId: ThreadId
  runId: RunId | null
  callSite: ApprovedCallSite
  route: EffectiveModelRoute
  consentId: string | null
  fallbackHop: 0 | 1
  startedAt: string
  endedAt: string
  outcome: EModelAttemptOutcome
  usage: ModelUsage | null
}
```

Pure `decideAlternate({ consent, callSite, selectedRoute, effectiveRoute, failure, admission, hasDeliveredContent, hop, compatibility }): AlternateDecision` admits Switch only when every predicate matches: consent current, exact primary account+revision covered, exact call site included, approved alternate different, no output emitted, normalized **availability** failure/gate denial, alternative fresh+compatible, hop=0. Do not treat tool errors, content-policy rejection, malformed model output, operator abort or unknown configuration/provisioning faults as fallback triggers. Temporary network/5xx retain01's own finite retry behavior; exhausting retries is not permission to send data elsewhere. A provider rate/quota/auth block covered by02 can be a trigger only after normalization. New credential revision/connection identity invalidates consent until reapproved; do not silently attach the same approval to a replacement account.

One-hop bound is durable per covered call site+consent generation: after switching, its effective override remains alternate across subsequent calls/restart. If alternate later fails, wait; primary recovery never clears the latch. Explicit Revoke clears automatic permission but leaves an already-used effective route unchanged; offer an explicit normal model selection to return, never flip a running session. A new approval may replace the one record only through a new preview and confirmation, not automatically on failure.

## Concrete implementation sequence

1. Extend05 `ModelRecoveryPort` with `previewAlternate({ rootThreadId, alternate, sites }): Promise<AlternatePreview>` and `approveAlternate({ requestId, preview, acceptedWarningIds }): Promise<AlternateConsent>`, plus `revokeAlternate({ rootThreadId, consentId, expectedGeneration, requestId }): Promise<AlternateMutationResult>`. `AlternatePreview` includes finite sites, resolved primary routes/origins, root own head/family generation,05's public availability snapshot fingerprint (not an admission receipt), and capability/context/cost/data warnings. `AlternateMutationResult` uses05 typed dispositions. Implement in new harness `model-recovery/approved-alternate.ts` behind the same family lock, expected-head append and actor ownership checks. These are methods on one registered module, not an extra port per setting. Approval is max128 explicit sites and exactly one alternate; duplicates/missing/pinned-site ambiguity produce Ineligible.
2. Add canonical root bookkeeping events `model-alternate-approved { consent }`, `model-alternate-revoked { consentId, generation }`, and `model-route-committed { actor:'approved-alternate', consentId, targets, fromRoutes, toRoute, cause }` using05 route decision schema. Store initial consent and each switched site's latch in the existing root event log; no new preferences table/checkpoint. Root decision commit precedes alternate request. Preserve current consent/latch through compaction and same-session rotation. Independent fork/copy must not inherit it. New children/utility owners are not automatically covered. Explicit pins require explicit selected site + retarget acknowledgment; identical model ids do not imply consent. Changes to a selected model, utility setting, account, effort or primary revision make that site's old approval inapplicable.
3. Add harness `model-recovery/routed-call.ts`: resolves one immutable primary/alternate handle, runs02/03 admission **for each actual network attempt**, records receipt, and returns its typed result. All adapters including cached OAuth generation/streaming and all four utility roles pass through this module. A denied admission records a decision with no network attempt/charge, not a fake attempt. Primary failures are observed by02 once; route change is decided by core, audited once and re-enters fresh alternate admission. Failed authority freshness/lease cannot be interpreted as a provider rejection. Neither child nor utilities can bypass shared account pause, half-open probe lease, revision CAS or Cloud freshness.
4. Remove production bindings of `childFallbackModel`, `createFallbackModel` and the retry `giveUpOf/switch()` path (delete obsolete wrapper files only after locating all remaining references; tests migrate to the new public module). `composition/child-model.ts`, `utility-model.ts`, `model-selection.ts`, shared turn wiring and utility model construction obtain routed calls from the same composed module. Do not chain wrapper(primary, wrapper(alternate,...)). Preserve existing helper→current-session routing as an explicit legacy route source inside this same module until that site is deliberately migrated to approved-alternate consent. Legacy scope is only the pre-existing helper-primary→current-session relation, one hop and exact current-session candidate captured at the safe boundary; it cannot authorize main fallback, arbitrary account substitution, third route or another wrapper. If a site has both sources, explicit consent replaces legacy routing for that site, never extends a chain. Selected defaults/pins remain unchanged. No fallback path resets the retry budget. Keep a total call bound `primaryMaxAttempts + alternateMaxAttempts` from01, with exactly one primary→alternate transition; the hop must not be reset by wake, clock jump or retry reassembly. Gate-denied primary costs zero attempts; alternate's normal bounded transient retries are permitted, but never retry a known unavailable credential. A route change is a fresh assembly boundary using05 provider-specific context/tool/image preflight, not `doStream(oldOptions)` against a different SDK provider.
5. Partial streams use05 `PartialModelStepError`: any semantic text/reasoning/tool-input delivered means **no automatic alternate**. Persist interrupted text+observed usage/primary receipt, settle any previously committed tools exactly once, then show05 explicit recovery. The model-call state carries deliveredContent rather than guessing from final assistant text. An output-free rejected stream may use one alternate only after releasing/cancelling the failed reader. A success arriving while another call marks account unavailable is retained; gate checks new calls, not tokens. Multi-agent simultaneous failures coalesce on issue/consent generation, not recursive alternate attempts.
6. Utility failure semantics stay honest. Titler/tldr may return their existing absent-title/footer outcome with a visible account issue; they do not block an otherwise eligible main route. Judge must return its existing unavailable/unknown evaluation result, not fabricate approval. A required compaction that cannot run leaves the main Waiting for model/context, not falsely compacted; already-written file/tool success remains committed. Approval preview lists the four named utility roles individually and states what context each sends. A new utility role is denied by default until explicitly added in a future user approval. Out-of-session/background model calls with no approved ownerThreadId have **no alternate**; they still use the gate and are auditable.
7. Accounting reuses05's per-route segments;06 adds only consent attribution and the audit trail. Extend05's `RouteSpend` segment with optional `consentId: string | null` so an automatic hop's spend is visibly billed to the approved alternate, not indistinguishable from operator recovery. Add `model-attempt-started { attemptId, callSite, route, consentId, hop }` before dispatch and `model-attempt-recorded { attemptId, outcome, usage }` after, owned by the calling thread (bodies in BOTH `core/src/events/body.ts` and `schema.ts` as in04). Failure to persist the route-committed or started event prevents dispatch (remain waiting), never an unaudited substitute. After-call receipt append failure cannot undo an already-paid call: retain the started record as usage-unknown, surface the accounting failure, and prevent further auto-hop dispatch until it records. On reopen unresolved started records are unknown attempts, not permission to replay. Multi-segment runs keep05's **Mixed models** summary; pricing always uses routeSpends.

## Consent UI and effective identity

Add web `features/threads/approved-alternate-dialog.tsx`, hook `data/use-approved-alternate.ts`; TUI `ui/components/approved-alternate.tsx` and composition adapter. Reuse05 preview layout and control-pending/error behavior. Entry is explicit **Approve automatic alternate**, unchecked by default; it never piggybacks on Continue with another model. Show primary route(s), alternate provider/account/model/effort, exact finite site checklist (main, named children, utilities), excluded pins, price/account changes, data destination and context/capability checks. Confirm says **Approve <model> for <N> listed call sites**; all sites default unselected except the initiating main. Adding children/utilities requires deliberate selection and renewed applicable warnings. Revoke is available beside current consent and confirms that it prevents future substitutions, not undoing work or silently reverting already-routed agents.

After automatic hop show a durable **Using <alternate> · approved alternate** badge and transition event, with Selected model still visible separately; expose provider+model+account and consent/cause in detail and attempt audit. Do not show a transient “retrying with session model” notice as the only evidence. If fallback is blocked, show exactly why and05 action. If a helper alone switched, say “Titler used <model>,” not “Your session switched.” Activity reports inference only while running; waiting rules from04 continue to apply.

Mobile/narrow: finite targets/warnings scroll, primary confirm stays available, long provider/account names wrap, accessible warning descriptions and one polite announcement per transition. TUI uses existing keyboard drawer patterns, hover regions and static waiting rows. Loading/error/zero eligible alternatives/conflict/revoke-in-progress follow05; lost ACK reconciles requestId and never grants consent twice.

## Feature/runtime/transport and release

Feature: core consent+one-hop decision; harness routed-call, effective family policy and receipt accounting. Runtime: same module composed by composeHarness on host/serve with02/03 authority adapter, existing log/ledger/clock/ids ports. Private routed-call module's transport slot is explicitly none; session recovery controls use the existing detached ModelRecoveryPort extended here, and receipt/identity projection uses EventLogPort/TurnLedgerPort/SessionActivityPort transports. Add strict wire approval/preview/revoke schemas and `EClientRequest` entries, browser client methods, serve handlers and remote harness methods; `ECapability.ApprovedModelAlternate` gates every control. Add no transport-only implementation of routing in web or TUI. Old serve has the control absent; absent new consent means no new main/alternate routing. Preserve only the pre-existing bounded helper→eligible current-session path; capability absence cannot widen it.

Release as `feat`, after05 ships. Coordinate new optional Turn JSON migration/API contract and released serve/TUI/web/Mac; regenerate api-router. Wire shapes are additive under capability gates, so preserve04 protocol minimum; old clients receive effective identity as readable route events and compatible outcome mapping. Automatic hop is enabled only when runtime accounting+all request paths+consent transport capability are present together. Do not ship a partial main-only implementation or silently retain nested/unbounded old child/utility paths; legacy equivalence is explicit and tested as above.

## Proof, exact test files and commands

New core `model-recovery/__tests__/alternate.spec.ts` property/matrix test: no consent, absent site, changed revision/model/effort, pinned without retarget, output emitted, hop1, provider/control-plane/tool faults, third-route attempt, restoration and unrelated account. Harness `model-recovery/__tests__/routed-call.spec.ts`, `__tests__/approved-alternate.spec.ts`, `__tests__/utility-alternate.spec.ts`; `ledger/__tests__/attempt-spend.spec.ts`; wire `__tests__/approved-alternate-wire.spec.ts`; serve `src/__tests__/approved-alternate.spec.ts`; web `features/threads/__tests__/approved-alternate-dialog.spec.tsx`; TUI `composition/__tests__/approved-alternate.spec.tsx` and render spec. Existing child/utility/fallback/retry specs are replaced through the public routing interface, not maintained as two competing policy suites.

Required integration: main+child+utility simultaneous failure shares one blocked account; exactly approved call sites may take one alternate; every attempt carries actual credential revision and gate lease; primary/alternate both fail without a third route or turn wake churn; partial output never crosses providers; successful live stream finishes; tools dispatch once; successful write survives judge failure; duplicate requests/approval revocation/restart preserve one-hop state; new child or utility setting never widens consent; primary restoration never oscillates; mixed-model/account and unknown usage costs are visibly honest. Local, serve, browser and detached TUI exercise the same module using scripted providers (no live paid calls).

```sh
bun run --cwd packages/core test src/model-recovery
bun run --cwd packages/harness test src/model-recovery src/ledger src/composition src/loop src/model
bun run --cwd packages/wire test
bun run --cwd packages/client test src/channel src/transcript
bun run --cwd apps/serve test src/__tests__/approved-alternate.spec.ts
bun run --cwd apps/web test src/features/threads/__tests__/approved-alternate-dialog.spec.tsx
bun run --cwd apps/tui test src/composition/__tests__/approved-alternate.spec.tsx src/ui/__tests__/approved-alternate-render.spec.tsx
bun run --cwd apps/api test src/api/platform/sessions
bun run typecheck
bun run lint
bun run --cwd apps/serve build:serve
bun run --cwd apps/tui build
bun run --cwd apps/web build:desktop
```

Root `bun install --frozen-lockfile` precedes implementation validation;03's real-Postgres migration/contract checks apply to the optional Turn JSON migration. Real browser/mobile keyboard and terminal render checks are release requirements, not claimed by this planning pass.
