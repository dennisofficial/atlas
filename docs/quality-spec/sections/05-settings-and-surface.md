# 05 — First-class Code Quality settings and honest recorded status

## Goal and teammate ownership
Surface teammate owns the TUI-only settings/status workstream. Controls consume registered settings descriptors; the status block reads harness-projected recorded facts through the active runtime adapters. No policy execution, model calls, source reading or ledger logic in the TUI.

## Read anchors
- packages/core/src/settings/definition.ts:3-10,17-29 — main-owned ESettingPage and ToggleDefinition.
- packages/core/src/settings/registry.ts:8-14,16-62 — main-owned category/standard enum IDs.
- packages/harness/src/settings/service.ts:194-199 — additive descriptor registration, preserving previously stored unknown values; no runtime definition removal/replacement.
- apps/tui/src/composition/use-settings.ts:81-90 and ui/settings-model.ts:68-85 — category rows come from shared registered definitions.
- apps/tui/src/ui/components/settings.tsx:173-209 — insert nonselectable status above groups; do not change rowIndex offsets.
- apps/tui/src/ui/components/settings/head.tsx:18-25,33-57 — current clipping can hide selected late tab; keep active category visible.
- apps/tui/src/composition/workspace.tsx:39-44,78-86 — live settings, conversation and agent view.
- apps/tui/src/composition/use-workspace-models.ts:138-143 — viewed agent ordering selected before scoped before root.
- apps/tui/src/composition/overlay-stack.tsx:251-285 — prop plumbing into settings.
- packages/core/src/ports/event-log.port.ts:32; harness/channel/delta-channel.ts:32-35 — own-event read and thread subscription.
- packages/harness/src/cloud/remote-event-log.ts:51-56,75-86; tui/composition/session-binding.ts:150-165 — existing remote adapter access; do not capture local-root log in a long-lived health reader.
- apps/tui/AGENTS.md — clickable must be hoverable; useClickRegion for any new clickable affordance.
- apps/tui/package.json:23-29 — typecheck, sharded tests, serial tests and binary build.

Opentui skill was loaded during settings investigation, with React/text/testing references. Respect no-timer React updates, stable snapshots, memoized StyledText and spans rather than per-cell renderables.

## Owned files
New: `apps/tui/src/composition/use-quality-health.ts`, sibling tests; `apps/tui/src/ui/components/settings/quality-health.tsx`, sibling tests.
Modify only `workspace.tsx`, `overlay-stack.tsx`, `ui/components/settings.tsx`, `settings/head.tsx` and focused existing settings/header tests. If a file's current size makes direct expansion violate limits, extract focused prop plumbing/view logic to a named adjacent module; do not rewrite unrelated workspace behavior.
Main owns core page/ID/descriptor types, shared settings registration, event/projection, harness public export and wire protocol. Review teammate supplies pure-descriptor settings adapter and `readQualityHealth` reader.

## Controls
- First-class `Code Quality` page, not a prompt editor/approval UI.
- Master `quality.enabled=false` initially; SRP `quality.policies.singleResponsibility=true` is inert while master off.
- Explicit `quality.recordExamples=false` toggle with clear local-source recording description; turning it on can collect without enabling Jev review.
- Registry-generated boolean per-policy rows; stable persisted keys supplied by policy descriptors, not derived from display title.
- Master-off preserves selections/history; zero-policy catalogue still shows master and 'No policies registered'.
- Catalogue is startup/registered-policy modularity, not arbitrary hot unload/replacement.

## Health hook and readout
New `useQualityHealth({app: Pick<AtlasApp,'log'|'channel'>,threadId,visible})` uses the CURRENT app.log and app.channel. Enable only when settings is open on CodeQuality page. ThreadId is `agentView.selected?.agentId ?? agentView.scopedTo?.agentId ?? conversation.threadId`. Label 'Viewed thread <short ID>' so a parent and a child are not silently conflated.

Read on opening; subscribe to that thread's existing events-appended while visible. Coalesce overlapping reads, dispose on close/runtime/thread change, discard late responses using generation identity. On refresh, retain previous readout instead of toggling loading each time; bail when event ID/state is unchanged. On read failure keep previous readout marked stale/unavailable, never turn failure into no-review. No polling, interval, model health request, additional wire operation or speculative live 'reviewing' spinner.

Public `QualityHealthRead` presentation is Loading | Ready(health) | Unavailable(lastKnown?,reason). The harness reader reads own rows and core projects latest quality record; it does not follow inherited parent records for display. The ledger's composed-history fold is a different purpose.

Readout is a compact non-selectable block above setting groups:
- Enabled/disabled and viewed thread label from current controls/identity.
- Last recorded policy/scope/path/outcome using event timestamp/provenance.
- Completed finding / no finding IN THAT reviewed scope / skipped / inconclusive / operational error / no recorded review.
- Explanation of initial coverage: direct TS/JS file tools only; shell/external writes not covered.

Do not call this 'current code clean', 'endpoint healthy' or 'all files reviewed'. Setting changes/new writes do not make old evidence a current-disk certificate. This is last recorded review status, not a second status store.

Use one/few existing text renderables with Spans. No focus handler or interactive row for status, so existing rowIndex selection/Cloud sign-in offset remains unchanged. Keep selected CodeQuality tab visible at narrow widths via a selected-centered tab window or abbreviated active label, using the existing cells helpers; update pure layout tests.

## Validation
From apps/tui:
- `bun run typecheck`
- `NODE_ENV=development bun run test:serial src/composition/__tests__/use-quality-health.spec.tsx src/ui/components/settings/__tests__/quality-health.spec.tsx` (choose .ts where no rendering occurs; standard test-home setup applies).
- Existing settings/header keyboard and rendering tests plus idle frame/snapshot regressions.
- `bun run build` once main integrates parser/event/settings changes.

Prove descriptor-added second policy appears without TUI code; master-off retains toggles; health shown only on quality page and own viewed thread; no selection offset; narrow tabs readable; close cleanup; live runtime adapter switch after lift; late previous read discarded; repeated unchanged refresh has stable state/frame count; read failure explicit; no new transcript row/no global notice spam.

## Completion preview and QA (implementation only)
In cloud, use apps/webterm's documented terminal preview after the full integration, not an HTTP mock of settings. Follow mandatory isolated preview rules, bind exposed sandbox port and hand operator tokenized URL. Do not start any preview during planning.

QA: open /settings and Code Quality; master off/recording off -> no extra write effects; enabled with unavailable decisions -> successful write plus recorded error; valid decision -> potential finding advisory; repeat corrective edit -> no repeated nudge; switch viewed child thread and local/cloud runtime -> correct own status; narrow terminal -> active tab/status visible; recordExamples opt-in -> local-only corpus capture. Use dedicated scratch session/home and fake data for controllable states, then a separately authorized real-provider smoke.
