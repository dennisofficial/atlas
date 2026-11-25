# Locked decisions — credential-availability stack (reconstructed)

Source: operator handoff in this session's first message + merged slice-1 PR #1628.
1. Availability ≠ credential health ≠ model selection ≠ defaults — four separate concepts;
   never silently rewrite defaults or disable unrelated accounts/models.
2. No Runtime/HMAC secret-identity scaffold — real fences only: cloud `AgentAccount.secretVersion`
   (already in DB, bumped at apps/api/src/api/platform/accounts/accounts.service.ts:207),
   local `StoredAccount.authorizationRevision` (new in slice 2, absent = 0).
3. Preserve bounded legacy helper→eligible-session fallback until slice 6; no new main
   auto-fallback. `fallback-model.ts` / `child-fallback-model.ts` stay.
4. Probe promotion (promoteProbe) is nonterminal: first output does not end observation — a later
   SSE error must still open the barrier. Successful streams are never aborted by lease expiry.
5. Provider reset times come only from provider evidence (`retryAt`/`resetAt` on the normalized
   failure); unknown stays unknown. Manual pause ≠ cooldown (clears only on replacement or
   explicit resume).
6. Slice 5 recovery is session-family-only; bulk/make-default deferred. No generic fallback
   graph, no second secret store, no second execution checkpoint. Preserve in-process host
   sessions (Dennis's daily driver).
7. Slice 2 has no Waiting state (slice 4) and no persistence (slice 3) — in-memory per-runtime
   authority, log-based resume only, no side-effect replay.
8. Slice-1 facts to build on: `classifyProviderFailure` is the single normalization point;
   quota/auth are hard stops (`EProviderRetry.Never`, credential-scoped); Delivery covers
   empty-key and header-not-delivered faults; utilities run `maxRetries: 0`.
9. Slice 3 persistence lives in the cloud DB, user-scoped, and the API owns the state machine:
   the pure core policy runs inside an API service transaction against one row per
   (userId, accountId, providerId, modelId), so probe admission stays atomic across runtimes.
   Harness gains a `RemoteCredentialAvailability` transport port (mirroring RemoteAccountStore);
   serve sandboxes compose it when a cloud client exists. Local in-process TUI sessions keep the
   in-memory authority — no local persistence, no second checkpoint (decision 6).
10. Slice-2 status note: slices 1–2 are merged (PR #1628, PR #1633). Slice 2's internal sections
    01–03 in this folder are historical; slice 3's specs are sections/04 and 05.
11. **Slice-3 scale decision (operator, 2026-11-01): ~10 concurrent sessions + ~3 users.**
    The original recovered spec (context/recovered/sections/03-cloud-authority.md) is the
    authoritative reference. We KEEP its coordination core — atomic probe claim via DB
    transaction + row uniqueness, durable cross-runtime barrier, expiring lease with reclaim —
    because ~10 concurrent sessions make the probe race real. We SIMPLIFY the identity/crypto
    surface: no AEAD `cav1_` receipt capsules, no lastPromotedProbeId ACK-loss machinery, no dual
    credential+route epoch vectors, no promoteProbe→fresh-cryptographic-permit swap. Instead:
    one barrier row keyed (userId, accountId, providerId, modelId); a server-issued opaque
    short-lived permit id checked server-side; promoteProbe keeps the behavior (mid-stream error
    re-blocks) by re-validating the same permit at terminal completion rather than issuing a new
    permit. The merged slice-2 core contract ({fence,value} revision, five-method port) stays as
    shipped; slice 3 extends it additively (server permit id + lease), it does not migrate it.
12. Slice-3 auth shape (review P0): the `credentialAvailability` router must use
    `SessionOrSandboxMiddleware` with `meta({ sandboxReachable: true, podReachable: true })` on
    inspect/admit/complete/promoteProbe (serve sandboxes present a sandbox token, not a
    better-auth session), and keep `control` session-only (manual controls are never
    token-reachable). The serve proxy must not forward `control` remotely. A test must prove a
    sandbox token reaches `admit` (not just a user session).
13. Slice-3 settlement durability (review P1): a remote admit whose session is unreadable at
    settle time must NOT silently drop a failed completion / probe promotion — the proxy throws
    `RemoteSettlementUnreachableError` so it isn't swallowed by the proxy. BUT the admitted-model
    wrapper must never let that settle error mask the original provider failure or corrupt a live
    stream: `admitted-model.ts` catches the settle error in `settleFailure`, the stream `settle`,
    and the stream `observe` promoteProbe, always preserving the original provider error / stream.
    Net: durability surfaces at the proxy (for logging/debuggability), but the wrapper keeps the
    provider error authoritative and the stream intact. The lease reclaims the unwedged barrier.
14. Slice 4B account-level Pause scope: Pause is offered only for availability keys that already have a waiting episode (the cloud barrier is keyed by account+provider+model, and the spec defines no account-wide key). No invented modelId ('*'). A healthy, idle account shows no Pause action and no caveat copy. Revisit if Dennis wants proactive account pause; that needs an account-scope key convention in core/api (likely slice 5).
