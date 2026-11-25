# Abstraction police

## Backlog (ranked)

1. `packages/plugin-sdk` type-depends upward on `agent` (`slots.ts:1`, `compose-pod.ts:1`), `client/transcript` (`slots.ts:2`), `control` (`slots.ts:17`). Move the shapes down or make slots generic.
2. `packages/client/src/session/session-rewind.ts:10` types restored images as v1 `SaidImageWire`; core already has the identical `SaidImage`. Small.
3. `apps/api/src/_module/trpc/api-latency.middleware.spec.ts:7` (infra) imports `api/platform/sessions/pod-errors`; `architecture.spec.ts` "shared infrastructure" fails on main, hidden by incremental CI.
4. `packages/github` imports v1 `@dltech/atlas-wire` (`ERepoTracking`, `GithubPrStreamFrame`, device-code types) in 7 files. Move the vocabulary to core.
5. `packages/client/src/channel/*` (~15 files) and `transcript/events-from-wire.ts` import `@dltech/atlas-wire/web`. Retarget onto `protocol` or split out a v1-compat module. Large.
6. `apps/tui` imports `@dltech/atlas-wire` in 12 production files. `wire` survived the v1 deletion, so this is a live retarget onto `protocol`. Low value.
7. `packages/api-router/src/generated/server.ts:16` pulls ~200 wire schemas.
8. Test-only deep relative imports across package roots: `apps/api` specs → `packages/api-router/src/generated/server`, `apps/tui/scripts`, `apps/mac/scripts/pack-host.ts:4`. Add `exports` subpaths.
9. `packages/host/__tests__/remote-calls-real.spec.ts:7` imports app `@dltech/atlas-daemon/testing`.

## Ruled out

- `packages/core` purity, `packages/ui` Atlas imports, plugin→plugin imports, clients importing `apps/api`: all clean (2026-11-19 sweep).
- `apps/tui` importing `core`/`client`/`observability`/`syntax`/`models`: v2 §7 lets apps compose tier packages.
- `packages/client/src/__tests__/browser-safe.spec.ts` importing wire: deliberate guard.
- Terminal not-found: API matches `ECallFailure.NotFound` since 2026-11-23; daemon and fake messages are display text only.
- Error-string matches in `packages/db/src/pool.ts:91`: external APIs.
- `packages/plugin-sdk/src/memory.ts` duplicating the memory summary shape as string unions: structural, kept so plugins need no core enums.

## Log

### 2026-11-24

- Fixed: `packages/memory` (used by v2 `apps/api` local pod control and `plugins/memory`) imported its record schemas and error codes from v1 `@dltech/atlas-wire`. Moved `memorySummarySchema`, `memoryEntrySchema` and the three `MEMORY_*_CODE` constants to `packages/core/src/memory/record.ts`; wire re-exports them; `packages/memory` depends on core and db only.
- Pinned in `core/src/memory/__tests__/record.spec.ts`. Mutations: stale code value, non-int revision, loose summary, non-nullable project (each fails 1 core spec); null-project mapping in `memories.ts` (fails 1 memory spec).

### 2026-11-23

- Fixed: `apps/api/.../control/terminal.service.ts` decided "pod lost this terminal" by matching the daemon's message prefix `no terminal `. It now checks the typed `error.code === ECallFailure.NotFound`, which protocol conformance (`testing/conformance/terminal.ts:194-290`) already pins for the fake and real daemon.
- Spec fixtures now carry codes. Mutations: code check never matches (3 specs fail), every failure counts as lost (1 fails), fake answers Internal (3 conformance specs fail).

### 2026-11-20

- Fixed: `packages/sandbox` (used by v2 `apps/daemon`) imported v1 `mirrorsThreadState` from `@dltech/atlas-wire`. Moved the serve env predicates (`API_PROVISIONED_ENV`, `POD_NAME_ENV`, `isApiProvisioned`, `writesBehind`, `isLocalPod`, `mirrorsThreadState`) to `packages/core/src/pod/serve-env.ts`; wire re-exports them; sandbox now depends on core only.
- Moved `wire/__tests__/writes-behind.spec.ts` to `core/src/pod/__tests__/serve-env.spec.ts`. Three mutations (provisioned flag, local-pod guard, whitespace trim) each fail core or sandbox specs.

### 2026-11-19

- Fixed: `plugins/memory` pod tools imported memory vocabulary (`EMemoryScope`, `EMemoryType`, name pattern, size limits) from v1 `@dltech/atlas-wire`. Moved it to `packages/core/src/memory/vocabulary.ts`; wire re-exports it; plugin dropped its wire dependency.
- Pinned `write_memory` limits (body 20000, description 300, type and scope enums) in `plugins/memory/src/pod/__tests__/tools.spec.ts`; the new specs pass on main and on the branch.
