# Credential availability and deliberate model recovery

Goal: stop repeatedly using unavailable credentials, surface why work is waiting, and resume on an operator-authorized model without changing defaults or replaying work.

## Scope

Planning only, based on checkout `eeee3e7ef`. Prior live investigation is [evidence/findings.md](evidence/findings.md); conceptual proposal is [artifacts/credential-availability-design.md](artifacts/credential-availability-design.md). [decisions.md](decisions.md) is the shared constraint list; [contracts.md](contracts.md) pins the reconciled interfaces and lifecycle. No code, config or production changes in this pass.

## Architecture

Core holds pure failure/admission/selection decisions. Harness owns all model-call enforcement and recovery. Runtime adapters bind account availability; Cloud persists user-scoped availability alongside credential authority; wire/API transport the same facts. Web and TUI render shared state/actions. Selected preference and effective model remain distinct. Execution resumes from the canonical event log.

## Ordered vertical slices

Each spec must name the delivered behavior, exact existing code anchors, concrete edits/types/order, its full feature/runtime/transport bindings, tests and actual commands, explicit non-goals, dependencies and rollout/release effects.
1. [Failure classification and bounded retries](sections/01-failure-classification.md) — hard spend exhaustion stops promptly, transient failures still retry, no credential-delivery misdiagnosis.
2. [Shared request admission within a runtime](sections/02-runtime-admission.md) — one unavailable credential stops new attempts across main/child/utility calls; revision-safe replacement and single recovery probe.
   3a. [Cloud API-key authority](sections/03-cloud-authority.md) — independently releasable durable API-key admission/control, atomic revision fencing, finite request-time freshness and two-runtime proof.
   3b. [Cloud OAuth enforcement](sections/03-cloud-authority.md) — separate PR extending that same authority to cached OAuth, grant/reconnect identity and token-cache writes, preserving host behavior.
3. [Truthful waiting state and provider controls](sections/04-waiting-and-controls.md) — visible reason/reset, deduplicated issue, manual pause/recheck, usable web/mobile/TUI with truthful activity.
4. [Explicit model switch and safe resume](sections/05-explicit-recovery.md) — finite session-family recovery, truthful actual-route accounting, no side-effect replay or silent pin/default changes. Account-wide bulk and make-default mutation are deferred, with no placeholder UI.
5. [One approved automatic alternate](sections/06-approved-fallback.md) — optional last slice; one bounded alternate, effective-route visibility, no oscillation or fallback graph.

## Delegation and integration

- Foundation planner owns sections01–02, including a concrete proposed normalized failure and availability contract.
- Authority planner owns section03 and proposes the Cloud storage/CAS/freshness binding against that contract.
- Experience/recovery planner owns sections04–06; shared contracts are proposals until main reconciles them.
- Main owns this index, decisions, consolidated contracts, sequencing and independent plan review. Agents must not change application source or each other's sections.
- Independent reviewer audits the full stack for old-client compatibility, control-plane waiting recovery, actual history/consent retention/fork filtering, and cross-slice protocol/revision consistency.

## Readiness

Implementation-ready at specification level. Three delegated planners authored the sections; independent review findings were reconciled and verified closed. [Human-facing roadmap](artifacts/implementation-roadmap.md) and [review record](artifacts/plan-review.md). No application code was edited and no implementation tests/builds/rendering ran.

## Planning gates

1. Reconcile proposed contracts into one named interface, one failure classifier and one state machine.
2. Resolve all authoring TODOs, ambiguous scope, atomicity/freshness choices and test commands before claiming buildable.
3. Independent reviewer checks cold-agent executability, realistic verticality, runtime parity and missing failure/concurrency cases.
4. Each implementation slice later starts from fresh origin/main, uses a small PR, passes focused tests plus package closure typechecks, and releases if new serve/wire behavior requires it. No implementation/PR is started by this planning pass.
