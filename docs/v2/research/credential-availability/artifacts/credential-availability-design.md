# Credential availability and deliberate recovery — design proposal

Status: initial conceptual proposal, superseded for implementation by ../plan.md, ../contracts.md and ../sections/. No implementation or operational changes authorized/performed.

## Problem

A provider rejecting calls is not evidence all work is running normally, nor evidence the stored credential is invalid. Distinguish hard quota, invalid/revoked auth, missing runtime configuration, temporary rate limits, network/provider faults, model access denial, and manual pause. Stop repeating known permanent failures across agents/sessions.

## Verified starting points

- packages/harness/src/composition/child-fallback-model.ts:67-118: child primary switches to current parent model on dead-credential failure; fallback is sticky for that wrapper. Exhausted retry budget can invoke switch(). The main model does not auto-fail over: packages/harness/src/composition/model-selection.ts:18-43 builds explicit select; packages/harness/src/loop/run-turn.ts:45-55,149-176 only installs fallback for a port carrying switch(). Utility-model fallback is a separate path at packages/harness/src/composition/utility-model.ts:85-108. A failing helper primary therefore must not be described as a failing operator-selected model. Child fallback also retries on some nonretryable classified faults because retrying-step.ts:182-193 calls onGiveUp on any no-retry plan; the alternate receives a fresh full budget.
- packages/harness/src/model/failure.ts:88-118: status-bearing errors are reduced to status/retryAfter; hard-quota meaning can be lost behind a 429.
- packages/core/src/events/run-failure.ts:66-91: quota identifiers classified before generic429, but message-only monthly-spend limit with rate_limit_error is RateLimited.
- packages/core/src/events/run-failure.ts:23-31: existing RunFailure already carries providerId/modelId/accountId.
- packages/harness/src/activity/state.ts:38-45: working=turning||background. Suspended work must not appear Running or keep retry loops alive.
- docs/architecture.md:142-155 and docs/core-contract.md:8-18: resume derives position from event log; no second execution checkpoint should be added.

## Recommended shape

One credential-availability module at the existing credential/model acquisition seam. Core owns pure failure classification and transition/route decisions. Harness owns execution/recovery and all model invocation types; runtime adapters implement the existing/new registered port. Cloud owns durable user-scoped availability and selection policy beside credential authority; wire transports the same contracts. UI renders state/actions, never implements retry/fallback policy. Do not build a generic fallback DAG or parallel secret store.

Availability observations are keyed by user+credential identity+credential revision and the smallest proven fault scope. Old failures cannot pause a replacement key. Provider/model faults must not disable unrelated accounts or models. Shared provider billing-scope exhaustion applies to all relevant routes only when the scope is known.

## Behavior

- Auth: attempt existing legitimate OAuth renewal/config refresh once where appropriate; proven rejected credential becomes action-required. Missing runtime header/config is a provisioning/configuration fault, not proof key invalid.
- Exhausted allowance/budget: immediately unavailable; use provider-proven resetAt when present. No guessed midnight. Unknown reset requires user recheck/top-up/fix.
- Temporary429: honor retry/reset hints, bounded retry/cooldown; repeated temporary failures open a circuit, not permanent credential disable.
- Network/5xx: bounded route/provider cooldown; do not mark credential invalid.
- Manual pause persists until operator resumes.
- Gate before a model request, not every streaming token. Single bounded recovery probe/lease prevents a storm after cooldown; revision/generation checks prevent stale observations overwriting recovery.
- One already-in-flight failed call may report after suspension; suppress subsequent requests. Do not abort successful streams or terminate shells/services.

## Recovery ceremony

Show one durable availability issue with reason/reset time/affected sessions, not per-child toasts. Session state becomes Waiting for model when no authorized route exists; no spinner suggesting inference continues.
Primary action: Continue with another model. Default scope is this session family. The first implementation deliberately excludes account-wide bulk recovery and make-default mutation; those remain separate possible followups, not placeholder controls. Cross-provider substitution changes cost/data destination/capabilities and is never silently authorized by credential availability alone.
Keep configured preference separate from effective active route. Optional automatic fallback is one explicitly approved alternate model, not a routing rule system. Record actual provider/model/account and switch cause; continue the same event log at the next model boundary, settling existing calls rather than replaying side effects. Do not auto-flip a running session back when the original resets; restore its eligibility for future routing.

## Proof required before implementation completion

Correct hard429 classification; replacement-key revision fencing; invalid Cloud credential delivery distinct from rejected key; concurrent agents share pause without retry storms; OAuth refresh single-flight; unrelated account/model faults isolated; manual pause; unknown reset; one half-open probe; no retry wake churn while blocked; control-plane outages do not fabricate invalid-key state; per-session selection leaves default unchanged; opted-in fallback only; actual effective identity visible; resume retains pending input/tool settlement; TUI/serve/web parity.

## Additional authority evidence

- Account health (active/limited/expired) is not admission: packages/core/src/credentials/selection.ts:17-53 ranks but never excludes even expired accounts; preferred account wins. Automatic availability and manual pause must not reuse health fields reset on secret replacement.
- API accounts already have secretVersion, incremented on replacement at apps/api/src/api/platform/accounts/accounts.service.ts:199-223. It is not currently exposed in account DTO/lease. Prefer extending this actual revision fence over inventing unrelated credential version semantics.
- Cloud serve refreshes account/config state before a new turn (apps/serve/src/serve-boot-finish.ts:125-128), but resumed turns skip this hook (apps/serve/src/turn-driver.ts:76-82). Failed refresh is swallowed and retains old state (apps/serve/src/cloud-state.ts:206-212). Signed-in local account cache allows 60-second cached/stale observations. This is not immediate cross-runtime revocation; availability admission needs an explicit bounded-freshness/invalidation contract, including already-cached OAuth tokens and ongoing turns.
- Model default affects new conversations; selected thread model and existing children are separate. apps/serve/src/thread-model.ts:65-100 requires explicit supervised-agent retarget. Recovery scope must name affected targets rather than assuming a parent model change rewrites all children.
- Native OAuth replacement preserves connection identity, while web/API sign-in can allocate a new connection and retire the old one (apps/api/src/api/platform/provider-sign-in/provider-sign-in.service.ts:173-195,228-270). Do not assume a connectionId survives all reconnect actions.
- No evidence from the read-only authority audit proves deployed Cloud is currently losing the inference/OpenRouter key; credential delivery diagnosis remains open.

## Open investigation

The logs do not establish whether the saved inference key itself is invalid or Atlas Cloud selected/delivered it incorrectly. Trace assigned account identity/revision and actual provider auth construction before labelling that credential invalid.
