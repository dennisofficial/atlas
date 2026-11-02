# 02 — Shared request-time admission inside one runtime

## Proposed shared contract — read this first

Recommendation for reconciliation with slices03–06; do not invent a competing classifier or account-health flag. Core exports the following from new `packages/core/src/credentials/availability.ts` and `ports/credential-availability.port.ts`. `NormalizedProviderFailure`, `EProviderFailureKind` and `EProviderFailureScope` come from slice01. All value unions are real E-prefixed TypeScript enums; compact declarations below are implementation signatures.

```ts
export enum ECredentialAuthority {
  Local = 'local',
  Cloud = 'cloud',
}
export type CredentialRevision = {
  authority: ECredentialAuthority
  issuer: string
  version: string
}
export type CredentialTarget = {
  accountId: AccountId
  revision: CredentialRevision
  providerId: string
  modelId: string
}
export enum EAvailabilityState {
  Ready = 'ready',
  Blocked = 'blocked',
  CoolingDown = 'cooling-down',
  Probing = 'probing',
  Paused = 'paused',
}
export type AvailabilityKey = {
  accountId: AccountId
  revision: CredentialRevision
  providerId: string
  scope: EProviderFailureScope.Credential | EProviderFailureScope.Route
  modelId?: string
}
export type AvailabilitySnapshot = {
  key: AvailabilityKey
  generation: number
  state: EAvailabilityState
  failure?: NormalizedProviderFailure
  observedAt: string
  eligibleAt?: string
  probeExpiresAt?: string
}
export type AdmissionPermit = {
  id: string
  target: CredentialTarget
  fences: readonly { key: AvailabilityKey; generation: number }[]
  probe: boolean
}
export type ModelBlocked = {
  target: CredentialTarget
  availability: AvailabilitySnapshot
}
export enum EAdmission {
  Allowed = 'allowed',
  Blocked = 'blocked',
}
export type Admission =
  | { kind: EAdmission.Allowed; permit: AdmissionPermit }
  | { kind: EAdmission.Blocked; blocked: ModelBlocked }
export enum ERequestCompletion {
  Succeeded = 'succeeded',
  Failed = 'failed',
  Cancelled = 'cancelled',
}
export type RequestCompletion =
  | { kind: ERequestCompletion.Succeeded }
  | { kind: ERequestCompletion.Failed; failure: NormalizedProviderFailure }
  | { kind: ERequestCompletion.Cancelled }
export enum EAvailabilityAction {
  Pause = 'pause',
  Resume = 'resume',
  Recheck = 'recheck',
}
export abstract class CredentialAvailabilityPort {
  abstract inspect(args: { target: CredentialTarget }): Promise<readonly AvailabilitySnapshot[]>
  abstract admit(args: { target: CredentialTarget }): Promise<Admission>
  abstract promoteProbe(args: { permit: AdmissionPermit }): Promise<AdmissionPermit | null>
  abstract complete(args: { permit: AdmissionPermit; result: RequestCompletion }): Promise<void>
  abstract control(args: {
    key: AvailabilityKey
    expectedGeneration: number
    action: EAvailabilityAction
  }): Promise<AvailabilitySnapshot>
}
```

````

This is the exact five-method lifecycle locked in `context/contracts.md`: `inspect`/`admit`/`promoteProbe` → updated `AdmissionPermit | null` / `complete` (enum Succeeded | Failed | Cancelled) / `control`. There is no generic report method, no Responsive/Cancelled report arms, and no succeeded-boolean parallel shape.

Interface invariants:
- `issuer` is an authority namespace, not a bearer token or email. The Cloud binding uses canonical API origin; `accountId` is the globally unique API account ID, and every authority operation derives/validates its owning user from the authenticated principal rather than caller input, and `version` is the API `secretVersion` (stringified). OAuth access-token `generation` is NOT credential replacement. There is no `Runtime` authority and no HMAC-of-secret identity scaffold — see "Revision prerequisite" below.
- No global/provider billing bucket: only the actual account+revision. Route keys additionally require exact provider/model. Credential keys omit `modelId`; admission checks BOTH the credential key and the exact-route key, Paused before Blocked before CoolingDown/Probing. No account enumeration or automatic alternate-account selection.
- Every permit records both lookup fences, including generation zero for absent keys. Generation is a barrier epoch, incremented on block/open/probe acquisition/recovery/control/replacement, not on each transient-counter update. A stale revision/epoch report or completion is ignored; duplicate terminal `complete` for the same permit is idempotent (first completion wins).
- **Terminal-completion semantics, exact:** every admitted request ends in exactly one terminal `complete`, attempted by the shared wrapper — Succeeded, Failed or Cancelled. A terminal **Succeeded** completion NEVER opens or clears availability state: an ordinary success does not heal an open barrier, because the barrier may have opened after the request dispatched. A terminal **Failed** completion (including a promoted probe's mid-stream failure) records the provider observation and may open the proven scope only against its exact still-current fences; otherwise it is ignored. A terminal **Cancelled** completion is neither success nor a provider failure: it closes only its own lease and mutates nothing.
- Pause is an overlay, not a failure kind: preserve the automatic reason beneath it. Resume removes only the overlay; it does not erase confirmed quota/auth. Recheck requests one probe, never marks Ready. Control uses expected-generation compare-and-set; conflict returns the current snapshot with no write and no HTTP request. Recheck while paused does not bypass pause. All returned reasons are bounded/sanitized data, never response bodies or secrets.
- `ModelAdmissionBlockedError extends Error` (new harness class) carries readonly `blocked: ModelBlocked`. It is **not** normalized into a `NormalizedProviderFailure`, is not retried, and is never passed to `complete` as a provider observation — a typed block is local gate output, not evidence about the provider.
- **Probe lifecycle:** every admitted request — ordinary or probe — is `admit → at most one promoteProbe → exactly one terminal complete`. `promoteProbe` is never terminal and never marks success at first output; only `complete` terminates a permit. An ordinary request never promotes; completion rules are the bullet above. For a probe, first meaningful output promotes exactly once: `promoteProbe` atomically validates both credential+route epoch vectors and the replacement identity **recorded on the permit** against current state (the permit is the fence carrier), changes the claimed scopes to Ready, and returns the **new ordinary permit with post-promotion fences** (`probe:false`). The returned permit replaces the caller's handle for the still-active request, so its later terminal completion is evaluated against the *current* epoch — a quota SSE error arriving after first output is an ordinary Failed completion and can open a fresh barrier. A stale/replaced/superseded promotion returns null, mutates nothing on the newer authority state, already-forwarded successful output is preserved, and terminal completion of the old permit is ignored. A Cancelled request goes straight to terminal `complete({kind: ERequestCompletion.Cancelled})` with no promotion. There is never a second terminal `complete` for the same permit and no arbitrary abortion of a healthy stream at lease expiry: expiry only fences the lease so its late completion cannot mutate state. A successful stream is not aborted because another request blocks, a promotion reply fails, or the old probe lease expires.
- **Cloud lost-ACK (03 binding, specified here per contracts.md):** idempotent promotion uses the original probe identity, not another model request. The authority retains `lastPromotedProbeId` plus the post-promotion epoch vector on claimed scope rows until the next barrier/control/replacement changes them. The original authenticated receipt may resolve ONLY that exact promotion to its deterministic post-promotion vector when a terminal report follows a lost promotion reply; any changed row/probe id/epoch invalidates it. A new ordinary receipt binds the post-promotion vector and same principal/attempt identity. No per-request execution checkpoint or general receipt database. Local gate state updates synchronously even if Cloud reporting times out — that is not durable cross-runtime propagation.

## Revision prerequisite (replaces the temporary HMAC identity)

Expose `secretVersion` to runtimes additively in this slice rather than building a runtime-only secret-digest identity that03 would then replace. Justification: the authority already exists — `apps/api/src/api/platform/accounts/accounts.service.ts:199-213` increments `AgentAccount.secretVersion` on every `replaceSecret` — it is simply not serialized into the account payload the store reads. The additive change: include `secretVersion` in the API account read/list DTO (and in the serve lease payload slice03 needs), have `RemoteAccountStore`/`CachingAccountStore`/`SignedInAccountStore` (`cloud/remote-account-store.ts:14-52`, `caching-account-store.ts:19-115`, `signed-in-account-store.ts:18-78`) pass it through, and stamp Cloud revisions as `{authority: Cloud, issuer: <canonical API origin>, version: String(secretVersion)}`. An older API without the field yields `version: 'unknown'` — such Cloud accounts are admitted WITHOUT revision fencing (logged once per runtime), which is exactly today's behavior, so nothing regresses; local vault accounts are always fully fenced. This is one DTO field plus pass-throughs, vs a salt/digest/tag map with its own lifecycle, persistence rules and false-identity risk. The API deploys on every merge, so the field is live before the client release ships; a client-only release is still safe against older APIs via the 'unknown' path. Slice03 keeps this revision as its CAS fence — no migration of identity semantics between slices.

Local revision (no Cloud involved): add optional `authorizationRevision: string` to `accountSchema` (`core/credentials/account.ts:68-86`). Local `AccountStore.add` assigns a UUID (`credentials/account-store.ts:64-90`); legacy accounts use deterministic `legacy:<accountId>` until first replacement. Extend the existing `replaceSecret` argument with optional `mutation: ECredentialMutation` (Replace/Refresh; absent means Replace) and optional `expectedAuthorizationRevision: string`. Local Replace writes a new UUID under the existing vault lock; Refresh preserves the revision and compares the expected revision before writing, throwing a typed stale-replacement error if changed. Update the local refresh (`refreshing-credential-port.ts:139-156`), OAuth `persistAccess` (`oauth-owned-secret.ts:83-116`) and handoff-only writes (`oauth-handoff.ts:123-162`) to pass Refresh+captured revision, and reread the saved account after mutation rather than returning `{...stored,secret}` with a stale revision. Status/label changes never change the revision. Environment key replacement and AccountsService login/replacement use Replace. Extend forwarding signatures of `AccountStoreProxy`, `SignedInAccountStore` and `CachingAccountStore` so local mutation options reach the LOCAL underlying store. At `RemoteAccountStore.replaceSecret` (`cloud/remote-account-store.ts:34-36`) explicitly project the outbound request to `{accountId,secret}`; strip `mutation` and `expectedAuthorizationRevision` because the existing `packages/wire/src/account-routes-wire.ts:63-66` strict input rejects them. Do not claim remote CAS or revision-preserving Cloud token refresh in02;03b's explicit cache-only OAuth route later supplies that contract. Add a strict old-server input regression proving the request contains no new local-only fields. Vault version2 (`credentials/vault-file.ts:5-15,54-69`) stays readable; the field is additive, no second file/table. Add a downgrade test documenting that concurrent old/new local binaries are unsupported for revision fencing (an old writer drops the field); call this out in release notes.

## Goal and independently useful outcome

After one confirmed exhaustion/rejected authorization, the next main, child, titling, tl;dr, judge, compaction or rotation model request using that account revision stops locally before dispatch. Other accounts/routes keep working. Replacing a local credential or deliberately resuming after a provider-proven reset allows one bounded attempt rather than a storm. This works for the daily-driver signed-out host runtime — fully fenced local revisions — and for all callers sharing a serve runtime. The slice does include one additive API DTO field (`secretVersion` exposure); that is not a blocker for the runtime outcome: local-vault fencing needs no API, Cloud accounts run fenced the moment the field is live (the API deploys on every merge), and the `version:'unknown'` fallback preserves today's behavior against older APIs meanwhile. This is enforcement, not a schema-only precursor.

Blocked turns finish with a typed `ModelBlocked` payload and a truthful terminal failure message using the **existing** Failed outcome in this slice. They do not remain Running. The richer durable Waiting activity/status and controls UI are slice04; do not add a partly handled `ETurnStatus.Waiting` here. Existing explicit Retry/Resume/model-select actions can drive another attempt; no automatic timer wakes or new execution checkpoint.

## Dependencies and evidence (checkout eeee3e7ef)

Depends on slice01's normalized classification and once-only give-up fix; slice01's preserved fallback wrappers become admission-aware here. Refresh anchors after rebase. Paths relative to `/atlas/workspaces/atlas`.

- `core/ports/registry.ts:43-53,90-123`: registered ports require runtime/transport slots. `composition/port-bindings.ts:14-24,66-73` provides shared/in-process manifests. Actual surface bindings: `apps/serve/src/compose-serve.ts:65-73` uses `inProcessPortBindings`; `apps/tui/src/composition/compose.ts:145-156` spreads `sharedPortBindings`. `composition/compose.ts:106-138,160-216,242-249` is the shared root.
- `composition/model-bindings.ts:77-101` constructs all four adapters; `model-catalogue.ts:63-79` is a second factory and must not bypass enforcement. `child-model.ts:87-103,122-145` and `utility-model.ts:75-108` create models through those adapters; `compose-utility-models.ts:48-63,73-86` wires helper fallbacks.
- `providers/anthropic-oauth.ts:79-90,121-138` and `providers/openai-oauth.ts:90-103,132-149` read credentials per request and perform one discard/read retry. `providers/inference-adapter.ts:61-78,102-109` and `openrouter-adapter.ts:70-87,102-109` resolve the actual account later than ModelPort construction. A wrapper only around ModelPort or the selected model is therefore insufficient.
- `credentials/refreshing-credential-port.ts:66-81,114-136,139-156` owns local refresh single-flight; `cloud-managed-credential-port.ts:111-130,209-245,278-296` can serve cached OAuth and coalesces minting. Admission must happen before returning cached credentials, not only inside mint/exchange.
- `loop/tracked-turn.ts:94-109,228-261,274-281` settles logged calls before inference and returns a failed model step without appending assistant/tool-call drafts. `loop/run-turn.ts:253-290` records failure and releases spend/sleep leases. Resume uses the log (`docs/architecture.md:138-159`).
- `packages/client/src/channel/turn-outcome.ts:13-19` has optional structured RunFailure on Failed; the wire duplicate is `packages/wire/src/run-failure-wire.ts:3-11` (no core dependency) consumed by `packages/client/src/channel/channel-wire.ts:35-47`. `intake/message-intake.ts:221-256` bounds failed wakes by witness; `composition/main-wake.ts:1-34` caps at three. Add no availability-driven wake timer.

## Precise edits, in build order

1. **Revision prerequisite first** (see above): API DTO field + store pass-throughs + local `authorizationRevision` + mutation options. No HMAC/digest scaffold is built.
2. **Pure admission module and registered port.** Add `core/src/credentials/availability.ts` (contracts/policy), `availability-plan.ts` (pure transitions with explicit `nowMs` and permit ID inputs), and `core/src/ports/credential-availability.port.ts`; export through `core/src/index.ts`. Add registry entry `CredentialAvailabilityPort: PortRegistryEntry<CredentialAvailabilityPort> & {transport: 'none'}`. Add `{runtime:'shared',transport:null}` to sharedPortBindings, inherited by inProcessPortBindings/TUI/serve/spec manifests. Transport is explicitly none because this is execution-side enforcement, like CredentialPort; the Cloud authority binding of slice03 also runs execution-side. Client-facing controls/snapshots later travel the existing session/settings transport, not remote execution of this port.
3. **Working runtime adapter.** Add `harness/src/credentials/runtime-availability.ts`, implementing the port with maps of metadata/counters/active permits only, ClockPort/IdPort injected, all decisions delegated to core. Add registrar `container/register-credential-availability.ts`, invoked in `create-harness-container.ts:156-158` before credential registration; one `instanceCachingFactory` instance inherited by child containers — one controller per harness runtime/root, so a session family sharing that root shares admission, and separate composeHarness roots/processes deliberately do not share until slice03. Register via factory, no tsyringe decorators.
4. **Stamp actual credentials.** Extend Credential with required `revision: CredentialRevision`; update production credentialOf constructors and typed fixtures. `credentials/credential-revision.ts` centralizes stamping: local = stored authorizationRevision/legacy ID; Cloud = String(secretVersion) from the DTO, or `version:'unknown'` against older APIs (no fencing, logged once). OAuth without authority in a local vault uses its local persisted revision. Never hash or embed access tokens; `accountId`/`updatedAt` are not revisions.
5. **One request wrapper at the credential-authorized LanguageModel seam.** Add `providers/admitted-model.ts` and `credentials/admission-credential-port.ts`. Bind a single model-use CredentialPort view in bindModels and providerAdapters; keep the raw credential port for OAuth handoff, usage HTTP, catalogue discovery and management. The view delegates actual read/refresh to the existing CredentialPort but checks admission against the chosen account/revision **before** raw read can mint/refresh; pin read to that chosen accountId and revalidate the returned revision before dispatch. The view resolves the account using existing chooseAccount/activeFor behavior and AccountStorePort — no additional selection algorithm. On a revision mismatch, cancel the obsolete permit and repeat acquisition at most once; a second change returns a delivery/configuration fault, not an infinite loop. For Cloud accounts with `version:'unknown'`, fencing steps are skipped but admission state still gates the account.
6. Each Anthropic/OpenAI/OpenRouter/Inference adapter passes the resolved card provider/model into admitted-model for both doGenerate and doStream; update both adapter factories. Internal `authorizedModel` returns credential+permit and uses the same wrapper, avoiding double admission. No provider fetch before a permit. Stream wiring follows the probe lifecycle above: initial doStream rejection → immediate terminal Failed completion; error parts and read rejection → terminal Failed completion once; first meaningful output → a single `promoteProbe`, and on a non-null return the caller swaps to the returned permit handle so the stream's terminal completion (success at end, failure mid-stream, or cancel) is evaluated against the post-promotion fences; on null the request settles and its completion is ignored. Caller abort/reader cancel → terminal Cancelled completion, releasing only its own lease. No request ever promotes twice. Generation collected from streams (OpenAI subscription `generationFromStream`) completes the same permit once, not a second one. Preserve backpressure, supportedUrls and provider options; metadata getters make no admission calls.
7. **Legacy helper fallbacks become admission-aware, not deleted.** child-fallback-model.ts and model/fallback-model.ts stay (slice01 narrowed their triggers). Before switching, the wrapper calls `admit` on the fallback candidate's target; a Blocked candidate abandons the fallback — the child keeps its original typed failure/terminal report, and utilities return their existing null/unreachable contract. A failed fallback request never re-enters the blocked primary (sticky/one-shot semantics unchanged). The candidate must be a distinct ref, already enforced by `parentModelFor` (child-model.ts:111-120). No fallback on malformed request, caller abort, ModelDenied or Delivery.
8. **OAuth rejection repair remains one legitimate repair.** For confirmed Auth only, the admitted wrapper coordinates the existing discard+read once through existing per-account refresh/mint single-flight, pinned to the same account and same authorization revision; renewal of access tokens is not a new revision or clearance of quota. Defer the first auth observation until the renewed request finishes; failed renewal transport becomes Delivery/Network, not invalid-key proof. A repaired successful request leaves Ready; a renewed request rejected again records Auth. Never renew for hard quota, bare403/model denial, missing header or empty key. Stream-delivered auth rejection after meaningful output is never restarted.
9. **Bounded blocked outcome.** Add `model/admission-blocked.ts`. In retrying-step, catch ModelAdmissionBlockedError before provider classification (including nested ModelStreamError): return `{ok:false,message,cause}` immediately — no sleep/onWaiting/fallback/reprepare, and crucially **no** `normalizeProviderFailure` on it. `runFailureOf` detects the typed error directly (typedKindOf arm), attaches optional `blocked: ModelBlocked` to RunFailure, and sets kind from the snapshot's underlying failure (Quota/Auth/RateLimited/Overloaded/Delivery/…) without re-deriving it from the thrown error. In LoopTurnRunner always return `failure` on Failed, using the same object recorded to run-failed; today it records a classification but returns the raw outcome. Failure text says the request was not sent, the reason and the evidenced reset/recheck requirement — never "invalid key" for delivery. Utility callers keep existing null/unreachable results; admission records the shared block before their catch, so swallowing a cosmetic title failure cannot bypass the gate. Core exports blocked data; SDK/error classes stay harness-only.
10. **No side-effect replay.** Do not move admission before pending-call settlement in runTrackedTurn, and do not wrap the whole turn in a retry. Retry only the next model boundary. Keep shells/services/previous successful streams alive. When one sibling blocks, outstanding requests finish normally and their old-generation successes cannot clear the barrier. Existing Resume reprojects the log and retains pending input/tool settlements; admission state contains no event cursor, tool input or execution checkpoint.

## Exact policy and races

Export constants in core: `TRANSIENT_FAILURE_WINDOW_MS=30_000`, `TRANSIENT_FAILURE_THRESHOLD=3`, `INITIAL_COOLDOWN_MS=1_000`, `MAX_LOCAL_COOLDOWN_MS=60_000`, `PROBE_START_TIMEOUT_MS=30_000`, `MAX_REVISION_REACQUIRE=1`. Slice01's five-attempt retry policy remains the outer upper bound (clock jumps cannot replenish it); admission may stop it earlier. All clock/ID I/O stays harness-side.

- Confirmed Quota/Auth => credential Blocked immediately. Quota with a provider-proven resetAt becomes probe-eligible at that exact instant; in v1 resetAt is almost always absent (slice01 found no verified error-metadata reset field), so quota normally requires explicit Recheck/replacement — that is the truthful default, not a gap.
- Temporary429 opens route CoolingDown immediately; eligibleAt = later of now+1s and the provider's Retry-After hint. Network/5xx/stall opens route CoolingDown on the third failure in30s; earlier failures use slice01 backoff. Cooldown doubles on a failed probe up to60s, but NEVER caps an evidenced provider not-before time to an earlier instant. No guessed billing reset.
- A request after eligibleAt atomically gets one probe lease and Probing; all simultaneous callers receive typed Blocked. No timer starts model work. Operator Retry/Resume/Recheck or a later legitimate request is the trigger. Recheck is CAS and coalesces concurrent presses, respecting any evidenced temporary Retry-After.
- A probe uses the real next requested model step, not synthetic inference or tool execution. Before any meaningful provider output, admitted-model applies a30s abortable start deadline. First nonempty text/reasoning/tool-input delta, complete tool call, or healthy finish triggers `promoteProbe`; on a non-null return the adapter has already set the claimed scopes Ready in the same mutation and the rest of the stream is ordinary — a later quota/fault SSE error still reaches terminal Failed completion against the post-promotion fences and can open a fresh barrier. A null promotion (stale/replaced/superseded fences) mutates nothing: the request settles, and its terminal completion is ignored. A probe error before first output fails the probe and doubles cooldown. Before any meaningful output a probe has a30s abortable start deadline and (Cloud)45s exclusive lease; no admission method runs on every output chunk. Timer/abort/cancel settles the owned permit once. A successful stream is never aborted because another request blocked, and lease expiry never kills a healthy stream — it only fences late completions.
- The local adapter does not grant another probe while it still owns an unclosed local attempt: expiry initiates abort/reader cancellation, then releases/fences it. Cloud slice03 must implement expiring leases + fencing because processes can disappear; an already-sent request is not a license to accept its stale completion.
- Ordinary Succeeded completions never heal an open barrier; ordinary Failed completions open or extend the scoped barrier only when every permit fence matches the current epoch. Old failures cannot overwrite a replacement revision or a successful later probe. A blocked primary never causes a blocked candidate to be attempted, and a typed Blocked is never fed back as a provider observation. New account A or model B is never silently chosen when pinned account A/model A is blocked. No global provider cooldown absent proven shared billing identity.

## Wire/type plumbing for the blocked payload

Extend the actual duplicate `packages/wire/src/run-failure-wire.ts:3-11` with optional blocked. Add browser-safe `packages/wire/src/credential-availability-wire.ts` with zod structural shapes for the availability contracts above (no core import; identical string enum values); export it from wire's web subpath and use it in run-failure-wire. Core RunFailure.blocked uses core's own enum/type definitions, and malformed/future blocked data parses to undefined rather than erasing an otherwise readable failure. `packages/client/src/channel/channel-wire.ts:35-47` already validates RunFailure through the core schema; extend its existing round-trip spec to prove blocked survives. `turn-outcome-wire.ts:40-45` retains Failed — no status change in this slice.

## Tests and commands

New core tests: `credentials/__tests__/availability-plan.spec.ts` (entire transition table, dual-key matching, epoch fences, pause overlay, unknown-version no-fence path). New harness: `credentials/__tests__/runtime-availability.spec.ts`, `credential-revision.spec.ts`, `providers/__tests__/admitted-model.spec.ts`, `composition/__tests__/runtime-admission.spec.ts`, `loop/__tests__/admission-resume.spec.ts`.

Required scenarios:20 simultaneous main/child/utility reads share one barrier/probe; **mid-stream quota SSE error after first output still completes the promoted permit as ordinary Failed and opens its current scope** (the §protocol regression); stale-fence promotion returns null with its late completion mutating nothing; lost Cloud promotion ACK resolved only by the original receipt against `lastPromotedProbeId`+epoch; changed row/probe/epoch invalidates it; already-open streams survive a new barrier; post-open old success ignored; replacement after request dispatch; replacement during refresh; failed-probe cancellation; duplicate completion idempotent; caller abort; token refresh does not clear hard quota; cached CloudManagedCredentialPort token denied without mint; alternate account/provider/model unaffected; blocked fallback candidate abandons the switch and the child keeps its typed failure; failed fallback never re-enters the primary; both doGenerate/doStream including SSE error parts; utility fallback and SDK internal retries cannot redispatch blocked work; silent/empty model steps cannot loop around admission; completed write tool count stays1 across fail+resume, pending approval/pending tool batch preserved. Exercise the real composed provider factories with fake HTTP/clock, not a stand-alone port fake only. Keep existing refresh/vault/adapter/intake regression suites. Add an API DTO spec asserting `secretVersion` serialization (`accounts.service.spec.ts` already asserts the increment at line132) and store pass-through specs for the remote/caching/signed-in stores.

Commands (implementation, not executed during planning; after root `bun install`):
```sh
bun run --cwd packages/core test src/credentials/__tests__/availability-plan.spec.ts
bun run --cwd packages/harness test src/credentials/__tests__/runtime-availability.spec.ts src/credentials/__tests__/credential-revision.spec.ts src/providers/__tests__/admitted-model.spec.ts src/composition/__tests__/runtime-admission.spec.ts src/loop/__tests__/admission-resume.spec.ts
bun run --cwd packages/harness test src/credentials/__tests__ src/providers/__tests__ src/composition/__tests__/child-fallback-model.spec.ts src/composition/__tests__/utility-fallback.spec.ts src/model/__tests__/fallback-model.spec.ts src/model/__tests__/fallback-stream.spec.ts src/intake/__tests__
bun run --cwd apps/api test src/api/platform/accounts
bun run --cwd packages/wire test
bun run --cwd packages/client test src/channel/__tests__/turn-outcome-wire.spec.ts
bun run --cwd apps/serve test
bun run --cwd apps/tui test
bun run typecheck
bun run --cwd apps/serve build:serve
bun run --cwd apps/tui build
````
Scripts verified: core package.json:9-12; harness:15-18 (`bun test --timeout30000`, arguments forwarded); wire:14-18; client:16-19; api runs `bun test` per its AGENTS.md; serve:6-10; tui:23-28; root:11-25. Run the root closure typecheck because core changes propagate into API/client/wire/web.

## Feature/runtime/transport coverage and release

Feature = pure normalization/admission and one authorized-model wrapper; runtime = shared in-memory adapter used by host and serve, with local-vault revision fencing and the existing refresh implementations. Transport slot = explicitly none for the execution port; the existing serialized RunFailure carries additive blocked data. The only API change is the additive `secretVersion` DTO field — it deploys automatically on merge and old/new clients tolerate it in both directions. Structural port manifests and spec containers must satisfy the registry (composeHarness fails typecheck otherwise — that breakage is the contract).

Local availability counters are deliberately ephemeral across runtime restart (credentials/revisions stay in the existing vault); durability, cross-runtime CAS and finite Cloud freshness are slice03, not falsely advertised here. Cloud accounts behind an older API (`version:'unknown'`) get admission gating without revision fencing — today's guarantee, clearly logged. Release `fix(credentials)` because shipped host/serve behavior changes; the additive API field requires no release coordination. Additive payload readers ignore unknown fields; new readers parse old failure events without blocked. No Waiting enum or protocol bump in this slice.

Non-goals: API-owned durable state/leases; cross-process account coherence; web/TUI redesign; automatic restart at reset; NEW model/account substitution routes or default changes; fallback consolidation (06); secret replication; a new event log/checkpoint. Acceptance is stopping actual provider calls in a composed runtime today, not merely compiling these types.
