# Abstraction improver

## Backlog (ranked)

1. `apps/api/src/api/cloud/skills/builtin-skill-source.ts` `isBuiltIn` / `builtInSkill` — renames of harness `isBuiltInSkillName` / `builtInSkillEntry`; callers in `skills.service.ts`.
2. `apps/web/src/features/settings/data/personal/use-settings-draft.ts` `usePersonalSettings` — returns `useCloudSettings()`; 7 settings pages.
3. `packages/client/src/transcript/service-ended-line.ts` `serviceEndingFailed` — rename of core `serviceFailed`; 2 callers + tui re-export.
4. `apps/tui/src/ui/exit-guard-model.ts` — 4 wrapper fns and 3 row aliases over `stop-guard-model`; dead `EXIT_GUARD_INSET`/`exitGuardCells` in `components/exit-guard.tsx`.
5. `apps/tui/src/build/info.ts` `clientVersionHeader` / `versionLabel` — `xOf(buildInfo())` conveniences, many callers; low value.
6. `packages/core/src/ports/file-capabilities.port.ts` `acceptsFileParts` — always `true`; guard in `apps/api/src/agent/agent-tools/read.ts` never fires. Remaining impl lives in harness.
7. After harness deletion: `packages/core/src/quality/registry.ts` (only ever one policy), `PortBindings`/`ComposedPortBindings` in `packages/core/src/ports/registry.ts`.
8. Small: `packages/client/src/stream/plugin-views.ts` `pluginViewOf` (no production caller); `packages/ui-native/src/use-theme.ts` `useScheme`.

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

- Swept `packages/` and `apps/` (skipping harness/agent-v1/serve, deprecated, files in open PRs #2368/#2272).
- Flattened `canonicalEvent` (core `record/chain.ts`) and `encodeVisibility` (control `stored-event.ts`), both pure renames of `canonicalJson`; 7 call sites now call `canonicalJson`.
- Pinned with new `core/src/record/__tests__/chain.spec.ts` and `control/__tests__/stored-event.spec.ts`; mutation-checked each.

### 2026-11-20

- Flattened `searcherFor` (`apps/api/src/agent/agent-tools/grep-search.ts`), a pass-through to `ripgrepSearcher`; `grep.ts` now calls `ripgrepSearcher` directly.
- Pinned the full ripgrep argv in `grep-process-port.spec.ts`; mutation-checked by dropping `--hidden`.
- Skipped files in open PRs #2469 and #2465.
