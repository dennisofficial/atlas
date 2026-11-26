# Abstraction improver

## Backlog (ranked)

1. `apps/tui/src/build/info.ts` `clientVersionHeader` / `versionLabel` — `xOf(buildInfo())` conveniences, many callers; low value.
2. Small: `packages/client/src/stream/plugin-views.ts` `pluginViewOf` (no production caller); `packages/ui-native/src/use-theme.ts` `useScheme`.

## Ruled out (earn their keep)

- `apps/tui/src/ui/stop-guard-model.ts`, `use-exit-guard.ts`, `use-container-guard.ts` — real state machine / key handling.
- `apps/web` `use-is-desktop`, `use-has-native-browser`, `useRouteParam`, sidebar context hooks — own sync-store/decoding/provider logic.
- Single-impl ports with test fakes: `InProcessRefreshLock`, `MediaRegistry`, `SubscriptionSession`, `SandboxWakeBoot`, `sandbox-provider`, `RandomIds`, `ChangeContentStore`.
- `packages/core/src/ports/*.port.ts`, `PortRegistryEntries`/`registeredPortToken` — DI seams with many bindings.
- `packages/host/src/holder/record/record-adapter.ts` `SessionRecord` — deep.
- `packages/control/src/testing/memory/*` — conformance twin.
- `PromptFragment`, hook base classes — plugin extension points.
- `registryOf<T>`, `createSessionsList`, `command-registry`, `scoped-config.factory`, `github-sweep-scheduler` factories, terminal/key/frame registries — real behavior.
- `thread-stream-adapter.ts` — adds cursor emission.
- Web personal-settings API one-liners (`putSecret`, `deleteMcpServer`, …) — each pairs a named request with `cloudCall`; inlining churns specs for little gain.

## Log

### 2026-11-19

- Swept `packages/` and `apps/` (skipping deprecated, files in open PRs #2368/#2272).
- Flattened `canonicalEvent` (core `record/chain.ts`) and `encodeVisibility` (control `stored-event.ts`), both pure renames of `canonicalJson`; 7 call sites now call `canonicalJson`.
- Pinned with new `core/src/record/__tests__/chain.spec.ts` and `control/__tests__/stored-event.spec.ts`; mutation-checked each.

### 2026-11-20

- Flattened `searcherFor` (`apps/api/src/agent/agent-tools/grep-search.ts`), a pass-through to `ripgrepSearcher`; `grep.ts` now calls `ripgrepSearcher` directly.
- Pinned the full ripgrep argv in `grep-process-port.spec.ts`; mutation-checked by dropping `--hidden`.
- Skipped files in open PRs #2469 and #2465.

### 2026-11-23

- Flattened `isBuiltIn` / `builtInSkill` (`apps/api/src/api/cloud/skills/builtin-skill-source.ts`), renames of `isBuiltInSkillName` / `builtInSkillEntry`; `skills.service.ts` calls the plugin functions directly.
- Existing `skills.router.spec.ts` already pinned all four call sites; mutation-checked each.
- Open PRs #2667/#2658/#2620 touched none of these files.

### 2026-11-24

- Flattened `usePersonalSettings` (`apps/web/src/features/settings/data/personal/use-settings-draft.ts`), a pass-through to `useCloudSettings`; 9 pages now call `useCloudSettings` directly.
- Pinned `useCloudSettings` read/fallback and save-then-reload in new `apps/web/src/lib/__tests__/use-cloud-settings.spec.tsx`; mutation-checked both.
- Open PRs #2801/#2800/#2789/#2749 touched none of these files.

### 2026-11-25

- Flattened `serviceEndingFailed` (`packages/client/src/transcript/service-ended-line.ts`), a rename of core `serviceFailed`; `notice-entries.ts`, `queued-notice-line.ts` and tui `pending-rows.ts` call `serviceFailed` directly; dropped the tui store re-export.
- Pinned the queued `failed: true` case in `queued-notice-line.spec.ts`; existing tui `service-ended-entry`/`pending-rows` specs pin the other two sites; mutation-checked each site.
- Open PRs #2919/#2914/#2913/#2872 touched none of these files.

### 2026-11-26

- Dropped stale backlog items: `exit-guard-model.ts` and `quality/registry.ts` no longer exist on main.
- Removed `FileCapabilitiesPort` and the always-`true` `acceptsFileParts` (core `ports/file-capabilities.port.ts`): no production binding, so the `read` tool's refusal guard never fired; dropped its registry entry and the spec-only `NoFiles` fake.
- Existing `read-files.spec.ts` pins the PDF path; mutation-checked by refusing file types (5 fail). `port-registry.spec.ts` mutation-checked by re-adding the key (typecheck fails).
- Open PRs #3005/#3001/#2968 touched none of these files.
