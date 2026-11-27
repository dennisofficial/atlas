# Abstraction improver

## Backlog (ranked)

1. `packages/github`: `normalizedRepo` re-exports core `normalizedPrRepo` twice (`github-pr-identity.ts:3`, `github-linked-prs.ts:12`); ~25 importers. Fold `control/src/repo-name.ts` `repoFullNameOf` (same rule) in too.
2. `packages/host/src/holder/record/record-facts.ts` `factsOfKindsIn` — set-of-kinds generic, only caller passes one kind.
3. `packages/wire/src/sandbox-sh.ts` — unimported duplicate of pods' `sandbox-sh.ts`.
4. Dead exports: `plugins/mcp/src/pod/resources.ts` `toolsSnapshotOf`/`serverIdFor`; `packages/pods/src/pods/pod-busy.ts` `readPodBusy` (spec/README only).
5. `plugins/services/src/pod/status.ts` `hasEvent` — `type` param only takes two constants.
6. `apps/web/.../setting-fields.ts` `fieldChanges` = `diffChanges`; `apps/tui/src/store/crew-visits.ts` re-export barrel; `apps/api/.../pod-sizing.service.ts` `PodSizing` type (one impl, no fake).
7. Low: tui `clientVersionHeader`/`versionLabel`; `useScheme` (ui-native); tui `*_MENU_ROWS` alias chain; `screenOnReturn`.

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
- `pluginViewOf` — 4 plugin callers, safe own-key lookup + parse.
- `plugins/web` `readerPortOf`/`searchPortOf` — README names them the second-backend seam.
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

### 2026-11-27

- Flattened six tui drawer wrappers (`accountsCells`, `servicesCells`, `rewindCells`, `shellsCells`, `switcherCells`, `threadsCells`), each `drawerCells(args)`, and six unreferenced `*_INSET = DRAWER_INSET` aliases; components call `drawerCells` directly.
- Pinned the services log wrap (new `services-render.spec.tsx`) and the accounts notice wrap (`accounts-render.spec.tsx`); the other four drawers were already pinned. Mutation-checked all six with width ±8.
- Open PRs #3089/#3071/#2968 touched none of these files.
