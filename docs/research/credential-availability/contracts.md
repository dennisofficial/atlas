# Canonical shared contract for implementation slices

This file is the final cross-slice authority; section-specific storage and transport types are adapters of it, not parallel policy. All entries below are design decisions for the plan, not claims implementation exists.

## One meaning and one admission owner

- `NormalizedProviderFailure` from01 feeds retries, reporting, OAuth repair and availability observations. A typed gate denial is not a new provider failure.
- `CredentialAvailabilityPort` from02 is registered execution-side (`runtime:shared`, `transport:none/null`) and implemented by local and Cloud runtime adapters. Every actual provider attempt uses it. Detached UI controls are separate transports over its shared feature logic.
- Credential target = actual account + authorization replacement revision + provider/model. Cloud issuer is canonical API origin; globally unique API accountId identifies the credential within it. Every Cloud operation derives and validates owner scope from the verified principal, never a caller-supplied userId. OAuth access-token rotation is not replacement.
- Local02 runtime availability is ephemeral except the existing-vault credential revision.02 exposes API `secretVersion` additively as a prerequisite.03a makes API-key availability authoritative across runtimes;03b adds Cloud-owned OAuth identity/cache/reconnect. Older API compatibility in02 is explicitly not revision-safe;03a+ never silently downgrade an API-owned request to that compatibility path.

## Exact request lifecycle

Retain02 inspect/admit/control types. Use this five-method port, with explicit terminal cancellation:

```ts
export enum ERequestCompletion {
  Succeeded = 'succeeded',
  Failed = 'failed',
  Cancelled = 'cancelled',
}
export type RequestCompletion =
  | { kind: ERequestCompletion.Succeeded }
  | { kind: ERequestCompletion.Failed; failure: NormalizedProviderFailure }
  | { kind: ERequestCompletion.Cancelled }
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

- Each actual request gets one permit. Ordinary success does not heal a barrier; ordinary failure can open the proven scope only against its exact still-current fences. Terminal cancellation is neither success nor a provider failure. Exactly one terminal complete is attempted by the shared wrapper.
- Before any meaningful output, a probe has a30s abortable start deadline and (Cloud)45s exclusive lease. No new method runs on every output chunk.
- First meaningful output promotes a probe exactly once. `promoteProbe` atomically validates both credential+route epoch vector/replacement identity, changes claimed scopes to Ready and returns the **new ordinary permit with post-promotion fences**. It is NOT terminal completion. The returned permit replaces the old one for the still-active request. A later SSE quota/failure must open its current scope through ordinary Failed completion. Final healthy finish completes Succeeded.
- Stale/replaced/superseded promotion returns null. Preserve/forward already successful output and do not mutate the newer authority state; terminal completion of its old permit is ignored. A successful stream is not aborted because another request blocks, a promotion reply fails, or the old probe lease expires.
- Cloud promotion acknowledgement loss is explicit: idempotent promotion uses the original probe identity, not another model request. Retain `lastPromotedProbeId` plus the post-promotion epoch vector on claimed scope rows until the next barrier/control/replacement changes them. The original authenticated receipt may resolve ONLY that exact promotion to its deterministic post-promotion vector when a terminal report follows a lost promotion reply. Any changed row/probe id/epoch invalidates it. No per-request execution checkpoint or general receipt database is added. New ordinary receipt binds the post-promotion vector and same principal/attempt identity.
- All generation/control/revision CAS checks apply to promotion and terminal failure. Old ordinary success never clears newer failure; old failure never rewrites a replacement key or a newer successful probe. Local gate state is updated synchronously even if Cloud reporting times out; do not call that durable cross-runtime propagation.

## Scope and rollout

- Preserve existing bounded helper→eligible current-session substitution through foundations. No hidden malformed/delivery/cancelled fallback, no nested chain or primary return. New automatic main fallback only in optional06.
  -03a covers remote API keys and03b covers Cloud-owned OAuth. Both share the exact same gate/promotion/terminal protocol. Manual Cloud account control remains user-session-only, never sandbox capability.
  -04 owns WaitingForModel as non-running resumable state, including typed authority-unavailable conversion and discriminated credential vs control-plane wait-episode identities. All legacy turn AND agent/roster egress is capability downconverted.
  -05 delivers explicit finite session-family recovery. Bulk-account recovery and make-default mutation are deferred; UI states defaults/other sessions remain unchanged. Minimum immutable actual-route/usage accounting lands no later than05;06 consumes it.
- History retention/filtering is implemented at actual destructive summary/copy/reference-fork owners. Rotation on this checkout compacts the same thread; it is not a new active-main migration.
  -06 adds one explicitly approved alternate; no generic routing graph, global rule engine, new secret store, or second execution checkpoint.
