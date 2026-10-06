# 05 progress notes (surface teammate workstream)

Worktree: /atlas/workspace/.atlas/worktrees/quality-surface (branch dennis/quality-surface).

## What exists on the branch (verified 2026-10-06)
- Core quality contracts ARE merged: packages/core/src/quality/{change,policy,registry,request,ledger,health,schema}.ts, exported from core index.ts:159-165.
- `projectQualityHealth({records})` + `QualityHealth` + `EQualityHealthStatus` live in packages/core/src/quality/health.ts; label const `QUALITY_HEALTH_LABEL = 'last recorded review'`.
- Event arm `code-quality-reviewed` exists (events/body.ts:253,269; schema.ts:166); Event envelope carries `at` (envelope.ts:10).
- ESettingPage.CodeQuality + page row (registry.ts:14, label 'quality'), ESettingId.QualityEnabled/QualityRecordExamples definitions at registry.ts:687,697.
- NOT present: harness `readQualityHealth`, `qualitySettingDefinitions`, packages/harness/src/quality/** (review teammate, section 02). TUI builds its own read against the section-02 contract with a typed seam.
- AtlasApp (apps/tui/src/composition/compose.ts:35) has `log: EventLogPort` and `channel: DeltaChannel` via HarnessApp (harness-app.ts:80).
- DeltaChannel.subscribe({threadId, listener}) -> Unsubscribe (delta-channel.ts:33); listener gets ChannelSignal incl. {type:'events-appended'}.
- Viewed thread order: `agentView.selected ?? agentView.scopedTo` (use-workspace-models.ts:138); fallback conversation.threadId. AgentSnapshot.agentId is ThreadId-typed (use-agent-view.ts:98).
- Settings component: apps/tui/src/ui/components/settings.tsx:173-209 renders groups in scrollbox; status block inserts above groups without touching rowIndex.
- SettingsHead (settings/head.tsx) clips left-to-right via clipSpans — late tabs (quality is last) can hide when narrow. Fix: window tab spans around pageIndex using spanCells/sliceCells from sidebar/cells.ts.
- Test patterns: hook specs use createTestRenderer+createRoot+act (use-cloud-connection.spec.tsx); app-level settings specs use testRender(<App>) + fakeApp (app-settings.spec.tsx). fakeApp exposes `.log` (fakeEventLog, fake-backend.ts:454) and real createDeltaChannel.

## Plan of record
1. New `composition/use-quality-health.ts`: QualityHealthRead = Loading | Ready | Unavailable(lastKnown). Own projection from app.log.readOwn (own thread rows only, matching section 02's readQualityHealth contract — swap to harness import when review teammate lands it). Generation counter discards late reads; coalesces overlapping reads; subscribes to events-appended/step-started/step-ended for viewed thread (settleAppend emits step-ended, not events-appended, when a step is in flight — delta-channel.ts:207-213); bails when head unchanged (no flicker, no frame churn); held last-known resets per generation so a failed read never borrows another thread's review.
2. New `ui/components/settings/quality-health.tsx`: non-selectable block, one `<text>` per line with memoized spans; honest labels incl. policyIds; coverage note wraps via wrapCells so the honesty qualifiers survive narrow widths; header puts thread label before the toggle states.
3. Plumbing: new `composition/use-workspace-quality-health.ts` (named QualityHealthStatusProps) computes thread (selected ?? scopedTo ?? conversation.threadId) + toggle states; workspace.tsx calls it (kept ≤300 lines by also extracting workspace-header.tsx); overlay-stack.tsx and settings.tsx pass it through; block renders only on CodeQuality page, above groups, no rowIndex offset.
4. head.tsx: selected-centered tab window (windowedTabSpans) with elision-cost-aware loop; active tab abbreviates via clipSpans when the strip can't hold it.

## Reviewer findings (sub-agent, addressed)
- step-ended refresh gap: FIXED (REFRESH_SIGNALS).
- lastKnown leak across threads: FIXED (held reset per generation) + test.
- elision-cost window bug (27-29 cell band): FIXED + test.
- honesty qualifiers clipped at narrow widths: FIXED (wrapCells) + test.
- policyIds never rendered / unavailable dropped detail: FIXED + tests.
- workspace.tsx >300 lines: FIXED (extractions).
- settings-render.spec.tsx needed qualityHealth prop: FIXED.
- NOT fixed (needs main/shared change): remote head() is a full composed read over the wire (remote-event-log.ts:64-67), so each refresh is two ReadEvents for cloud threads. No new wire op added; recommend main add a cheap head op or accept the cost. Seq-based bail key (rewind reuses seqs) accepted as low risk.
- Known harness quirk documented by probing: OpenTUI root.render() remounts the tree WITHOUT running effect cleanups; in-tree state-driven updates clean up correctly. Test harnesses must drive prop changes through in-tree state (see use-quality-health.spec.tsx mount/rerender), never a second root.render().

## Validation (all from apps/tui)
- `bun run typecheck` — clean.
- `NODE_ENV=development bun run test:serial` on: use-quality-health.spec.tsx (15), quality-health.spec.tsx (14), head.spec.tsx (7), app-settings.spec.tsx (12), settings-render.spec.tsx (22) — 70 pass / 0 fail.
- Regression suites: app-settings-{model,mouse,secrets}, app-cloud-tab, app-footer-strip, workspace-refactor, tool-block-idle, app-header-render — 39 pass / 0 fail.
