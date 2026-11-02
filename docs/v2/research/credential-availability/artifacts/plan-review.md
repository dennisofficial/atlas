# Implementation-plan review

Status: independent review complete. All reported P1/P2 findings closed at the specification level after a full review and narrow correction verification. Planning only; application checkout clean, no tests/build/rendering claimed.

## First independent review findings and corrections

1. **P1 — legacy strict agent-status readers:** turn-only downconversion insufficient.04 now requires capability-conditioned conversion at all roster/agent/read-activity egress and actual legacy-schema tests.
2. **P2 — contradictory revision prerequisite:**02 no longer creates temporary Runtime/HMAC credential identities; it exposes actual API secretVersion additively.03a/b enforce complete authoritative fences and cannot silently take02 old-API compatibility path.
3. **P2 — control-plane wait cannot recover:**04/05 now use discriminated WaitEpisodeRef supporting credential-backed and control-plane/configuration episodes, with explicit typed conversion and commit revalidation, no invented account/key.
4. **P2 — history retention/fork/rotation assertions:**04/05/06 name actual SURVIVES_SUMMARY, destructive summary, copy-fork filtering and reference-segment projectors, with recovery-history.spec.ts. Rotation corrected to same-thread non-destructive compaction, not new-main transfer.

## Main integration corrections

- Preserve bounded existing helper fallback instead of removing working behavior in foundations; malformed/delivery/cancelled faults cannot be hidden by alternate routing.
- Lock promoteProbe as nonterminal and terminal completion as Succeeded/Failed/Cancelled; later SSE errors remain observable after first output. Exact post-promotion fencing and lost-ACK resolution in contracts.md.
- Remove unverified billing-reset error fields; unknown reset remains unknown.
- Split Cloud API-key and OAuth delivery into separate reviewable03a/03b PRs.
- Deliver finite family-only manual recovery first; defer account-wide bulk/default mutation. Actual-route identity/accounting is required by05, reused in optional06.
- Cloud issuer canonical API origin + globally unique account ID, owner scope derived from verified principal; no caller identity authority.

## Second review findings and applied corrections

- Strict old API account-secret input rejects local mutation/CAS options:02 now explicitly projects RemoteAccountStore output to `{accountId,secret}` and tests old strict input. Local-only revision options stay local;03b owns a separate explicit cache-only contract.
- Waiting-clear wording disagreed:04 now forbids clearing on generic turn start/resume/reconnect/dismiss; only the confirmed eligibility/explicit-route transition clears runtime and persisted episode together.
- Issuer and old-API downgrade wording diverged:02/contracts now consistently use canonical API origin + globally unique accountId, with owner derived from authenticated principal at every authority operation.03 explicitly rejects unknown/incomplete authoritative fences for its supported credential classes;02-only legacy compatibility is not a03 fallback.
  -03 refresh ordering contradicted zero-refresh block: corrected to metadata→admit→raw acquisition/refresh outside transaction→fence/deadline revalidate→dispatch.

## Final check before ready

Independent reviewer verified all four corrections and reported them closed. Prior four findings were also closed. No unresolved reported P1/P2 findings remain in the scoped plan review. This is specification-level readiness, not proof of implemented correctness. No implementation tests/builds/rendering run; source untouched. Final roadmap distinguishes six required slices plus optional seventh.
