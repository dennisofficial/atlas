# Package README drift routine record

## Ruled-out claims

- `packages/schedule`: `minimumGapMinutes` gives 60 for a once-a-day cron. The gap is cyclic (`src/gap.ts:5-17`).
- `packages/previews`: two concurrent `expose` calls make one tunnel (`pg_advisory_xact_lock`, `src/preview-tunnels.ts:24-29`).
- `plugins/skills`: "five built-in skills" matches `src/pod/builtin.generated.ts:24-44`.
- `plugins/sessions`, `packages/control`: "32 files, 256 KB each, 1 MB in all" are decimal units (`packages/core/src/paths/context-files.ts:1-3`).
- `plugins/memory`: description "at most 200 characters" is the tool limit (`src/pod/write.ts:21-22`). The zod schema allows 300.
- `plugins/mcp`: `mcpServerPort()` in the example is the real caller (`apps/api/src/agent/registered-plugins.ts:119`).
- `plugins/crew`, `packages/host`: the grouped sub-agent wake text is correct (`packages/core/src/agents/ending-hold.ts:47-65`).
- `packages/core`: "the nine phases" matches `EHookPhase` (`src/hooks/hooks.ts:16-26`).
- `packages/plugin-sdk`: `composePlugins` drops `entryFolds`, so "collect them yourself" is correct.
- `packages/pods`: `@dltech/atlas-pods/sandbox/sandbox-provider` resolves through the `./*` export.
- `packages/db`: `.agents/skills/prisma-8/SKILL.md` is relative to `packages/db/`.

- `packages/pods`: the six-hour grace both sweeps measure from `archivedAt` still holds after #2722 (archive sleeps at once).
- `plugins/crew`: "names its group size" counts the step's `agent_spawn` calls (`src/pod/spawn-group.ts:18-22`).
- `plugins/services`: "one for each port" is the newest row per port (`src/client/index.ts:59-69`).
- `packages/notifications`: presence TTL 90 s (`packages/core/src/notify/presence.ts:5`).
- `packages/memory`: "the edit path checks it" is right; only `editMemory` checks the body limit (`src/memories.ts:187`).
- `packages/host`: the boundary spec still greps `@dltech/atlas-harness` after v1 deletion (`__tests__/boundary.spec.ts:16-20`).
- `packages/notifications`: the presence key `atlas:v2:presence:<userId>` keeps `v2` on purpose (`src/presence-store.ts:11`).
- `@dltech/atlas-native-commands` is the name of `commands/` (`commands/package.json:2`), not a stale rename.
- Decision links named `docs/decisions/00NN-v2-*.md` are real file names.
- `packages/sandbox`: "cgroup v2 or v1" and `CGROUP_V2_CPU_STAT` name the Linux cgroup versions.

## Runs

### 2026-11-23

- Window: 74 h (Monday). All 45 in-scope READMEs changed. Rotation: `packages/media`, `packages/memory`.
- Corrected 30 READMEs. Most fixes: names that no longer exist (`GithubEventFilter`, `GithubPrStreamRouter`, `graphOf`), usage examples that did not compile, and omitted public exports.
- `/rotate` added to `commands/README.md`. Pod-call routing and read holds added to `packages/host/README.md`.
- Possible bugs: `plugins/github` `SUBSCRIPTIONS_VIEW` has no registration; `plugins/memory` description limits 200 and 300 disagree.

### 2026-11-24

- Window: 26 h. 31 changed READMEs. Rotation: `packages/models`, `packages/notifications`.
- Corrected 27 READMEs. Most fixes: omitted public exports, three usage examples that did not compile (previews, quality, protocol) and one that cited a deleted file (observability).
- Removed names that no longer exist or are not exported: `CONTEXT_MIRROR_MAX_BYTES`, `ContextMirror`, `describeControlPlaneContextFiles`, `buildRoutineGraph`.
- Possible bugs: `plugins/github` `SUBSCRIPTIONS_VIEW` still unregistered; `operator.input` fragment reaches sub-agents that cannot call the tool; `composePodCommands` returns no commands without `ctx`.

### 2026-11-25

- Window: 26 h. 40 changed READMEs (v1 deletion, `v2` prefix removal, `apps/trigger` flatten). Rotation: `packages/observability`, `packages/plugin-sdk`.
- Corrected 28 READMEs. Most fixes: paths under the deleted `apps/trigger/src/trigger/` and `apps/api/src/trigger`, omitted public exports, and `v2` wording.
- Usage examples that did not compile: previews (`livePreviewPeersOf`), web (`jinaKey` is a function), classifier, wire. Removed `takeBack`, `qualityNoticeOf`, `serve-env`.
- Possible bugs: `SUBSCRIPTIONS_VIEW` still unregistered; github subscribe reasons name a `subscribe` tool; `applyServePriority` has no caller; `SessionStreamOlderPage` is not exported.
