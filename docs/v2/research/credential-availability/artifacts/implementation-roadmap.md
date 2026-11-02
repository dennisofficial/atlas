# Credential availability: implementation roadmap

Planning deliverable. No application implementation, production mutation, tests/builds, commits or pushes have occurred. Baseline `eeee3e7ef`; refresh/re-anchor before each later implementation PR.

## Ordered slices and proof

1. **Classify failures and bound retries** — one provider failure meaning for retry/reporting; confirmed allowance exhaustion stops promptly, transient faults retain finite backoff, malformed Cloud delivery is not labelled invalid credential. Preserve narrowly bounded existing helper→eligible session fallback. Proof: hard quota one request/no sleep, transient maximum budget, delivery/model403 isolation, one appropriate OAuth repair and no hidden SDK retry. [Spec01](../sections/01-failure-classification.md).
2. **Gate every request within a runtime** — shared main/child/utility admission, revision-safe replacement, local pause/cooldown/probe semantics and typed blocked failure through existing UI. Proof: concurrent20 callers share exclusion/one probe, cached OAuth cannot bypass gate, late error after first output still opens barrier, completed write remains once. Includes additive API secretVersion exposure, not a temporary secret fingerprint store. [Spec02](../sections/02-runtime-admission.md).
3. **03a: Share API-key availability across Cloud runtimes** — durable per-account/route state, authenticated uncached per-attempt gate, CAS receipts and user-session controls. Proof: two independent runtimes/real PostgreSQL enforce the same failure; one valid probe; replacement/report/pause races; bounded authority outage; no local/env key transfer. [Spec03a](../sections/03-cloud-authority.md).
4. **03b: Extend the same authority to Cloud OAuth** — cached tokens still gate; grant/reconnect identity distinct from access-token refresh; canonical account/authorization fences and cache-only writes. Proof: cached OAuth rejected before another model request, refresh doesn't clear exhausted allowance, reconnect replaces once, old grant reports/caches cannot affect new grant, signed-out host baseline preserved. Separate migration and PR from03a. [Spec03b](../sections/03-cloud-authority.md).
5. **Truthful waiting and provider controls** — durable Waiting for model, deduplicated reason/reset, manual pause/remove/recheck, no fake activity or wake churn; usable web/mobile/TUI and legacy-client egress. Proof:30 waiting children produce one issue/no repeat requests, reopen/park retains wait, old strict agent/turn schemas work, keyboard/narrow layouts render correctly. [Spec04](../sections/04-waiting-and-controls.md).
6. **Choose another model and resume safely** — preview/confirm finite session-family scope, pins protected unless explicitly retargeted, defaults/other sessions unchanged, immutable actual route/usage accounting. Proof: two-client stale-preview conflict/idempotent lost ACK, same child/log retained, interrupted output preserved, completed tool effects once, no unsafe provider/capability/context switch. [Spec05](../sections/05-explicit-recovery.md).
7. **Optional: one approved automatic alternate** — one explicit finite consent and one route hop, reusing admission/manual recovery/accounting. Proof: no consent/no hop; both routes unavailable→wait, never third route or oscillation; no automatic switch after visible output; prices/account/actual model are honest. [Spec06](../sections/06-approved-fallback.md).

## Simplicity constraints

One failure classifier, one availability port, existing credential authorities, existing event-log resume. No provider roulette, second secret store, second execution checkpoint, guessed quota resets, silently changed defaults or blanket provider disable. First recovery ships session-family-only; bulk-account and make-default mutation are out of this stack. Optional automatic alternate is not required for the useful core feature.

## Implementation delegation

Run slices sequentially because their public contracts build on each other. Within a slice, delegate disjoint implementation/tests/UI work after the common contract is locked. The main agent owns integration and acceptance; an independent reviewer weighs spec and repository standards before claiming completion. Do not fan out overlapping edits to core enums, wire schemas, credential composition or migration refs.

## References

[Plan/index](../plan.md) · [Canonical contracts](../contracts.md) · [Decisions](../decisions.md) · [Review checklist](plan-review-checklist.md).
