# 01 — Normalize provider failure once and stop bounded retries honestly

## Goal / user-observable outcome

A confirmed monthly-spend/quota429 stops on its first rejected request instead of five minute-spaced attempts. A temporary429/network/provider fault still gets bounded backoff. The terminal failure and retry log describe the same reason, actual account and model. Missing Atlas-delivered authentication is never described as proof the stored key is invalid. Existing legacy helper fallbacks (child → parent session model, utility/title → session model) keep working, but only for credential-class failures on a distinct eligible candidate — never for malformed requests, caller aborts, model-access denials, or delivery bugs that must surface as themselves.

This slice delivers behavior in host and serve without an API migration. Slice02 adds the shared admission gate; slice06 owns any consolidation of helper fallback policy with explicit route consent.

## Dependencies / baseline anchors

No prior implementation dependency. Read `plan.md`, `decisions.md`, the design artifact and architectural one-record rule. Anchors are checkout eeee3e7ef, repository root `/atlas/workspaces/atlas`; refresh after rebase.
- `packages/harness/src/model/failure.ts:43-60,88-118`: provider identifiers may say permanent, but a status-bearing error becomes `{status,retryAfterMs}`. `core/src/models/retry.ts:57-64,74-90` then treats429 as temporary regardless of hard-quota evidence. Retry-After accepts numeric seconds only and is capped to60s.
- `packages/core/src/events/run-failure.ts:66-91` independently classifies quota before429; it has no provider-message evidence. `harness/src/model/run-failure.ts:43-51,63-82` independently extracts status/codes and even maps RefreshFailed to Auth. Hence retry and terminal meaning diverge. `model/provider-error.ts:11-36,38-65` already bounds body/identifier extraction.
- `harness/src/loop/retrying-step.ts:46-52` says onGiveUp runs only after retryable-budget exhaustion; implementation at182-193 invokes it on **any** `planRetry.retry=false`, including a status-bearing permanent400/401/402/403/404/413/422, resets attempts to0, and can repeat indefinitely if the callback always returns true. Clock jumps at164-166 reset `attempts=0`, replenishing the whole budget on every jump. Null failure at170-179 never invokes it.
- `composition/child-fallback-model.ts:15-39,67-118` defines dead credentials broadly: auth statuses 401/402/403 **and** CredentialError delivery failures (NotFound/Expired/Unreadable/Unsupported) silently switch to the parent. A delivery bug — a credential that never reached the provider — therefore hides its own root cause behind a fallback. `loop/run-turn.ts:45-55,149-176` structurally discovers `switch()` only on child ports; the main model (`composition/model-selection.ts:18-43`) has no fallback and gets none before06.
- `composition/utility-model.ts:85-108`, `compose-utility-models.ts:48-63,73-86`, `model/fallback-model.ts:98-147`, `model/titler.ts:81-87`: automatic session-model fallbacks for helpers, including a second title attempt. These stay; their candidates become availability-gated in02 and their triggers are narrowed here.
- `providers/provider-key.ts:3-20` protects against an empty key producing a missing auth header. `providers/inference-adapter.ts:61-78,102-109` and `openrouter-adapter.ts:70-87,102-109` know the actual account before request. `providers/failure-account.ts:3-34` attaches only accountId and walks up to8 causes.
- `providers/openai-oauth.ts:132-149` and `anthropic-oauth.ts:121-138` legitimately discard/read once after401/403 and do not resend unchanged secrets. Preserve renewal; stop renewing for model permission denial or missing delivery.
- `model/ai-sdk-model-port.ts:129-141` sets maxRetries0. Utility calls do not all do so: `model/titler.ts:68-76`, `tldr.ts:72-79`, `summariser.ts:59-64`, `rotation/carry-over-summary.ts:69-74`, `classifier/critique.ts:31-37`; Judge already uses0 at `classifier/judge.ts:42-48`.
- Reset-field evidence check (2026-10-31, this repo): `resets_at`/`reset_at` appear only in **usage endpoint** payloads (`usage/parse-anthropic-usage.ts:3-18`, `usage/parse-codex-usage.ts:5-27` mirroring codex-rs RateLimitStatusPayload), never in an error response. `x-ratelimit-reset` appears only in GitHub fetch code. The live failure evidence (`context/evidence/screenshot-thread-logs.txt`) is an Anthropic "monthly spend limit. Please try again later." message with no reset metadata. **There is no verified vendor error-body reset field; v1 must not invent one.**

## Concrete interface

New pure `packages/core/src/models/provider-failure.ts` owns these exports; no SDK/error classes or I/O enters core. Export through `core/src/index.ts`.

```ts
export enum EProviderFailureKind {
  Auth = 'auth',
  Quota = 'quota',
  RateLimited = 'rate-limited',
  Network = 'network',
  Overloaded = 'overloaded',
  Stalled = 'stalled',
  Delivery = 'delivery',
  ModelDenied = 'model-denied',
  ContextOverflow = 'context-overflow',
  InvalidRequest = 'invalid-request',
  Cancelled = 'cancelled',
  Other = 'other',
}
export enum EProviderFailureScope {
  Credential = 'credential',
  Route = 'route',
  Request = 'request',
}
export enum EProviderRetry {
  Transient = 'transient',
  Never = 'never',
}
export type NormalizedProviderFailure = {
  kind: EProviderFailureKind
  scope: EProviderFailureScope
  retry: EProviderRetry
  message: string
  statusCode?: number
  providerCode?: string
  providerType?: string
  providerId?: string
  modelId?: string
  accountId?: AccountId
  retryAt?: string
  resetAt?: string
}
export type ProviderFailureEvidence = {
  providerId?: string
  modelId?: string
  accountId?: AccountId
  statusCode?: number
  providerCode?: string
  providerType?: string
  providerMessage?: string
  message: string
  retryAt?: string
  resetAt?: string
  sdkRetryable?: boolean
  transport?: boolean
  stalled?: boolean
  cancelled?: boolean
  delivery?: boolean
  authorizationDelivered?: boolean
}
export function classifyProviderFailure(args: {
  evidence: ProviderFailureEvidence
}): NormalizedProviderFailure
export function normalizeProviderFailure(args: {
  cause: unknown
  message?: string
  providerId?: string
  modelId?: string
  nowMs: number
}): NormalizedProviderFailure
```

The last function is **harness**, implemented in `model/failure.ts`, not core: bounded unwrap/extract/sanitize then call the single pure classifier. `ProviderFailureEvidence` is not serialized. The normalized type is the only provider meaning consumed by retry, fallback eligibility, OAuth repair, later availability and terminal reporting. Add a zod schema for normalized public fields in core for run-failed schema reuse; do not persist raw evidence/body/header maps.

Adapt `planRetry({failure,attempts,policy,jitter,nowMs})` and `retryReasonOf(failure)` to accept NormalizedProviderFailure; remove old status-only ModelFailure/isAuthFailure exports after replacing their callers/tests. Keep ERetryReason for notices; mapping is pure kind-to-reason (RateLimited; Overloaded with5xx => ServerError except529; Network; Stalled => Network). A Never classification cannot be revived by an SDK retryable flag, a clock jump or the give-up callback. `runFailureOf` invokes this normalization and maps kind to ERunFailureKind; only non-provider TurnFault/escaped-crash handling remains outside it. `ModelAdmissionBlockedError` (slice02) is never passed through this normalization and never becomes a provider-failure observation.

## Classification and false-positive rules — concrete recommendation

Priority is delivery/cancellation provenance, explicit permanent provider evidence, model/request evidence, then status/transient hints. Normalize identifier casing once. Extraction looks only at an actual APICallError/StreamProviderError (including ModelStreamError causes), not arbitrary tool output, assistant prose, stored failureCause, or `Error('quota exhausted')`. Walk causes/lastError max8 with cycle detection; body max16,384 characters, provider text max2,048, identifier max80, final safe message max500. Retain the current secret/query redaction. Stream error.data and APICallError.data/responseBody use the same profile.

| Evidence                                                                                                                                                                                  | Single normalized result | Scope / retry                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------ |
| Atlas MissingKeyError, unreadable/missing/unsupported credential, provisioning/store delivery failure, provider says missing authentication header                                        | Delivery                 | Request / Never                                                                            |
| Caller abort                                                                                                                                                                              | Cancelled                | Request / Never; no quota/auth observation                                                 |
| `insufficient_quota`, `billing_hard_limit_reached`, `payment_required`, or402 with delivered credential                                                                                   | Quota                    | Credential / Never                                                                         |
| Allowlisted provider monthly-spend text below, even429+rate_limit_error                                                                                                                   | Quota                    | Credential / Never                                                                         |
| `invalid_api_key`, `authentication_error`, `invalid_authentication`, explicit revoked/expired authorization after legitimate renewal; bare401 only with positive auth-delivery provenance | Auth                     | Credential / Never                                                                         |
| `permission_error`, generic403, model_not_found/model access denial,404                                                                                                                   | ModelDenied              | Route / Never, never account invalidation                                                  |
| context_length_exceeded or413                                                                                                                                                             | ContextOverflow          | Request / Never                                                                            |
| 429 without hard evidence                                                                                                                                                                 | RateLimited              | Route / Transient                                                                          |
| 529,5xx, named overloaded/upstream error (existing exact upstream400 profile)                                                                                                             | Overloaded               | Route / Transient                                                                          |
| Dropped connection/timeout/stream stall                                                                                                                                                   | Network / Stalled        | Route / Transient                                                                          |
| Other400/422/schema error; other SDK/local exception                                                                                                                                      | InvalidRequest / Other   | Request / Never; SDK retryable true accepted only for non-permanent provider-origin faults |

For message-only quota evidence: initial profile is Anthropic provider-origin `error.message`, status429 or400, providerType `rate_limit_error`, matching case-insensitive whole clauses `monthly spend limit` or `monthly spending limit` with a limit-state verb (`exceeded`, `reached`, `would exceed`, `will exceed`) in the same sentence. Do not match merely `monthly`, `limit`, `quota`, `rate limit`, token-per-minute text, a generic local Error, or another provider's text. Fixture source is the observed live text in `context/evidence/screenshot-thread-logs.txt` ("monthly spend limit. Please try again later."), redacted of account data. New provider text profiles require a fixture; unsupported phrases remain transient429 rather than risking disabling a valid key.

Auth-delivery provenance is positive request construction evidence: actual credential resolved, nonempty secret, provider auth settings/header constructed for this account. Add harness-only metadata to existing failure-account attachment, including provider/model and `authorizationDelivered:boolean`, before invoke and while consuming the provider stream. `providerKey` missing-key failures attach delivery with accountId before throwing; use providerKey for API-key construction in OpenAI/Anthropic as well as the compatible providers. A provider response explicitly saying missing Authentication/Authorization header overrides an invalid-key identifier: Delivery. An unknown-origin401 is nonretryable Delivery/Request, not confirmed bad credential. RefreshFailed/token endpoint unreachable is Network or Delivery depending cause, never Auth solely because refresh failed; explicit expired grant after refused renewal can become Auth, but a credential not present locally remains Delivery. No availability state changes in this slice.

Reset hints — evidence-honest v1: `retryAt` comes only from the Retry-After response header (RFC7231 numeric seconds or HTTP-date, parsed case-insensitively against supplied nowMs; negative/nonfinite/invalid rejected). This supplies **retryAt**, not a billing reset. `resetAt` stays **undefined in v1**: the only reset fields found in this repo are usage-endpoint payloads, not error metadata, and the observed live quota error carries none. Keep `resetAt` in the type so slice04 renders "reset unknown — recheck after top-up" truthfully; do not scrape dates from prose, do not reuse rate-window usage resets as quota resets, no local-midnight guessing. A verified provider error-metadata reset field may be added later only with a captured fixture. Keep future retryAt instants intact; past retryAt yields no extra delay. For Quota, retryAt never makes it transient.

## Precise implementation order / files

1. Add pure type/schema/classifier above plus `core/src/models/__tests__/provider-failure.spec.ts`. Change core retry.ts:8-12,45-64,74-90 and its spec to consume it. Numeric default policy `{maxAttempts:5,baseDelayMs:1000,maxDelayMs:10000,maxRetryAfterMs:60000}` unchanged. If retryAt would require a sleep longer than maxRetryAfterMs, stop this turn and expose retryAt; never truncate the provider not-before time and retry early. For permitted waits delay = max(policy backoff, retryAt-now), bounded only by refusing the retry. Add optional retryAt/resetAt to RunFailure and runFailureSchema; add ERunFailureKind.Delivery and ModelDenied with remedies Retry/SwitchModel for route denial and FixCredential/Retry for delivery ("FixCredential" opens configuration/sign-in, not a claim the key is rejected). Historical MissingCredential remains parseable.
2. Replace model/failure.ts parallel classification with normalization; narrow provider-error.ts extraction to bounded evidence, and add `model/failure-provenance.ts` for WeakMap metadata reused by failure-account (not a second secret or execution store). Attach the normalized result to the caught failure object via WeakMap so terminal reporting reuses the same classification and its absolute hints; repeated reporting never recomputes a relative Retry-After against a later clock. Errors without object identity normalize on demand. `runFailureOf` uses that result, preserves typed TurnFault and safe escaped-crash behavior. Identity from actual request wins over mutable selected identity at failure time.
3. In retrying-step.ts:157-202 normalize every provider failure once and plan retry on that class; Never settles immediately. **Fix onGiveUp instead of removing it**: invoke it only when (a) the normalized failure is Transient and `attempts >= policy.maxAttempts` (budget genuinely spent), or (b) the normalized failure is credential-scoped Quota/Auth — and at most **once per step invocation** (a `gaveUp` flag; a second consultation settles the failure). A successful giveUp gets the fresh `attempts=0` budget once, as the existing comment describes; it can never be replenished a second time. Remove the clock-jump budget replenishment at164-166: a jump may interrupt the in-progress sleep but must not reset `attempts`, so a step can never exceed five provider attempts across repeated jumps. Keep thrown-vs-stream-result compatibility. Null/unclassifiable failures (170-179) keep settling directly without onGiveUp. Update the RetryDeps comment at46-52 to the real contract.
4. **Preserve the legacy helper fallback modules; narrow their triggers.** No file deletions. In child-fallback-model.ts: replace the broad `DEAD_CREDENTIAL_FAILURES`/`isAuthFailure` test (15-39) with the normalized classification: the step-level short-circuit fires only for Quota/Auth (credential-scoped); Delivery (missing/unreadable/unsupported credential, missing auth header), ModelDenied, InvalidRequest and Cancelled rethrow unchanged so the root cause reaches the terminal report. Keep the sticky never-return-to-primary semantics and the lazy parent resolution. The child fallback candidate is only a _distinct_ session model (`parentFor` already refuses the same ref at child-model.ts:111-120); slice02 additionally gates the candidate through admission before switching. Utility/title fallbacks stay one-shot and un-sticky; their session-model candidate likewise becomes admission-gated in02, and a blocked candidate simply yields the existing null/unreachable helper contract. Main model gains no fallback before06.
5. Add `maxRetries:0` to the five utility SDK callsites identified above, preserving Judge and main stream settings, so helpers do not hide SDK-internal retries. Preserve one legitimate OAuth discard/read repair for confirmed Auth; both OAuth files replace REFUSED_STATUSES tests with the shared normalized kind+delivery evidence. Never renew for bare403, quota, delivery or denial. Changing fallback triggers changes no selected defaults, agent type settings or saved thread models.
6. Extend request provenance across initial SDK call and stream error chunks, and update tests through actual adapters. In run-turn Failed branch compute failure once, append the exact object and return `{...outcome,failure}`; existing serialization then carries reset hints. Do not append assistant speech/tool-call drafts for a rejected step. Mirror optional retryAt/resetAt in `packages/wire/src/run-failure-wire.ts:3-11`, which deliberately has no core dependency. `packages/wire/src/turn-outcome-wire.ts:40-45` keeps existing Failed status; client tests prove optional-field preservation and unknown kinds still map to Other. No new transport endpoint or status enum.

New production files: core/models/provider-failure.ts; harness/model/failure-provenance.ts. Keep each module under300 lines; pure profile helpers can live in core/models/provider-failure-profiles.ts rather than bloating the classifier. Existing model/failure.ts remains the sole SDK-to-normalized seam. No new session port in this slice: reuse ModelPort/CredentialPort request path, failure metadata and the existing run-failed event; registry entries at core/ports/registry.ts:49-53 already cover these. The availability port arrives in02.

## Tests / executable commands

Add/modify these sibling tests and make assertions on actual request counts, not just kind strings:
- core `models/__tests__/provider-failure.spec.ts`, existing `models/__tests__/retry.spec.ts`, `events/__tests__/run-failure.spec.ts`: hard429/code+message precedence, misleading monthly text,403 route isolation, delivery precedence, explicit cancellation, resetAt always absent without verified metadata, retry not before a long retryAt, five transient attempts.
- harness `model/__tests__/provider-failure-retry.spec.ts`, `run-failure.spec.ts`, `statusless-provider-failure.spec.ts`, new `provider-reset.spec.ts` (Retry-After seconds/HTTP-date only; usage-endpoint resets_at payloads are NOT accepted as error metadata): APICallError.data/body, StreamProviderError.data, wrapped/cyclic causes, redaction/body limits, terminal/retry identity+reason equality, RefreshFailed not invalid key.
- harness `loop/__tests__/retrying-step.spec.ts`, `upstream-http-retry.spec.ts`, `retry-log.spec.ts`, `retry-intake.spec.ts`, `retry-compaction.spec.ts`: hard Quota/Auth consults onGiveUp once; Transient budget exhaustion consults it once; permanent non-credential faults (400/404/ModelDenied/Delivery) never consult it; a callback that always returns true cannot produce a second consultation or a third model; five attempts maximum even across repeated clock jumps; correct notices and model-boundary reassembly.
- `composition/__tests__/child-fallback-model.spec.ts`, `child-model.spec.ts`, `child-model-wire.spec.ts`, `utility-fallback.spec.ts`, `utility-provider-fallback.spec.ts`, `model/__tests__/fallback-model.spec.ts`, `fallback-stream.spec.ts`: kept and updated — Quota/Auth on primary switches to a distinct parent once and never returns; Delivery/ModelDenied/malformed/abort do NOT switch and surface their own kind; same-ref candidate never switches; failed fallback never re-enters primary.
- provider `__tests__/adapter-credentials.spec.ts`, `inference-adapter.spec.ts`, `anthropic-oauth.spec.ts`, `openai-oauth.spec.ts`: missing header/empty key vs rejected delivered key; renewed OAuth once; same-secret no resend; generic403 no renewal; actual SSE quota errors. Add zero-SDK-retry tests at the five utility callsites.
- `packages/client/src/channel/__tests__/turn-outcome-wire.spec.ts`: hints survive the Failed payload; old payload/no-failure and future failure kind remain accepted.

Commands, after root `bun install`, from repository root (not executed in this planning pass):
```sh
bun run --cwd packages/core test src/models/__tests__/provider-failure.spec.ts src/models/__tests__/retry.spec.ts
bun run --cwd packages/harness test src/model/__tests__/provider-failure-retry.spec.ts src/model/__tests__/run-failure.spec.ts src/model/__tests__/provider-reset.spec.ts src/model/__tests__/statusless-provider-failure.spec.ts
bun run --cwd packages/harness test src/loop/__tests__/retrying-step.spec.ts src/loop/__tests__/upstream-http-retry.spec.ts src/loop/__tests__/retry-log.spec.ts src/loop/__tests__/retry-intake.spec.ts src/loop/__tests__/retry-compaction.spec.ts
bun run --cwd packages/harness test src/composition/__tests__/child-fallback-model.spec.ts src/composition/__tests__/child-model.spec.ts src/composition/__tests__/utility-fallback.spec.ts src/composition/__tests__/utility-provider-fallback.spec.ts src/model/__tests__/fallback-model.spec.ts src/model/__tests__/fallback-stream.spec.ts src/providers/__tests__
bun run --cwd packages/wire test
bun run --cwd packages/client test src/channel/__tests__/turn-outcome-wire.spec.ts
bun run typecheck
bun run --cwd apps/serve build:serve
bun run --cwd apps/tui build
```
The exact scripts are core/package.json:9-12, harness/package.json:15-18 (`bun test --timeout30000`), wire/package.json:14-18, client/package.json:16-19, serve/package.json:6-10, tui/package.json:23-28, root/package.json:11-25. Provider suites use mock HTTP by default; no live credentials or Docker suites are required to establish this behavior.

## Coverage / non-goals / compatibility

Feature: single pure classification, visible bounded retries, truthful terminal report, narrowed-but-preserved legacy helper fallback. Runtime: shared provider adapters/loop, both host and serve; main, configured children and every utility SDK call. Transport: existing run-failed/Failed schema extended additively; explicit none slots for ModelPort/CredentialPort unchanged. UI is not edited here; existing failure text displays the reason and structured fields are ready for04.

No durable account availability, cross-runtime revocation, user pause controls, default rewrites, model recovery/resume workflow, broad billing organization fan-out, NEW fallback authorization (existing legacy fallbacks only), fallback consolidation (06), tool replays or checkpoint store. No claim that the live inference key was itself invalid: the investigation did not establish that.

Release as `fix(credentials)` and build shipped TUI/serve, because request/retry behavior changes. Existing events keep parsing and old clients ignore new hint fields/kinds; new wire kinds fall back to Other in old core readers. Explicit release note: delivery faults and model denials on configured child/utility models no longer silently switch to the session model — they now report their own cause. No API route removal, protocol enum change or data migration is needed.

Acceptance: (1) delivered Anthropic monthly-spend429 =>1 request,0 sleeps, Quota terminal with resetAt unknown; (2) ambiguous generic429 => at most5 requests and correct waits, including across clock jumps; (3) bare403/model denied => route error, no renewal, no fallback switch; (4) missing OpenRouter auth header => Delivery, no renewal or alternate request; (5) revoked OAuth repaired once can succeed; (6) Quota/Auth on a child switches once to a distinct session model and never returns; a failed fallback does not re-enter the primary; (7) failed utility leaves main model/default intact; (8) failed step appends no tool-called and completed prior tool effects remain exactly once.
