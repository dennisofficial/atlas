# Package README drift routine record

## Ruled-out claims

- `packages/schedule`: `minimumGapMinutes` gives 60 for a once-a-day cron. The gap is cyclic (`src/gap.ts:5-17`).
- `packages/sandbox`: "`apps/serve` calls it" is true through the `@dltech/atlas-harness` re-export.
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

## Runs

### 2026-11-23

- Window: 74 h (Monday). All 45 in-scope READMEs changed. Rotation: `packages/media`, `packages/memory`.
- Corrected 30 READMEs. Most fixes: names that no longer exist (`GithubEventFilter`, `GithubPrStreamRouter`, `graphOf`), usage examples that did not compile, and omitted public exports.
- `/rotate` added to `commands/README.md`. Pod-call routing and read holds added to `packages/host/README.md`.
- Possible bugs: `plugins/github` `SUBSCRIPTIONS_VIEW` has no registration; `plugins/memory` description limits 200 and 300 disagree.
