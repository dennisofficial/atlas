# Abstraction police

## Backlog (ranked)

1. `packages/plugin-sdk` type-depends upward on `agent` (`slots.ts:1`, `compose-pod.ts:1`), `client/transcript` (`slots.ts:2`), `control` (`slots.ts:18`). Move the shapes down or make slots generic.
2. `packages/client/src/channel/*` (~15 files) and `transcript/events-from-wire.ts` import `@dltech/atlas-wire/web`. Retarget onto `protocol` or split out a v1-compat module. Large.
3. `apps/tui` imports `@dltech/atlas-wire` in 12 production files. `wire` survived the v1 deletion, so this is a live retarget onto `protocol`. Low value.
4. `packages/api-router/src/generated/server.ts:16` pulls ~200 wire schemas.
5. Test-only deep relative imports across package roots: `apps/api` specs → `packages/api-router/src/generated/server`, `apps/tui/scripts`, `apps/mac/scripts/pack-host.ts:4`. Add `exports` subpaths.
6. `packages/host/__tests__/remote-calls-real.spec.ts:7` imports app `@dltech/atlas-daemon/testing`.

## Ruled out

- `packages/github` → wire: gone since 2026-11-26; github depends on core only for its vocabulary.
- `apps/api/src/_module/trpc` importing `api/platform`: gone; `architecture.spec.ts` passes on main (2026-11-25).
- `packages/core` purity, `packages/ui` Atlas imports, plugin→plugin imports, clients importing `apps/api`: all clean (2026-11-19 sweep).
- `apps/tui` importing `core`/`client`/`observability`/`syntax`/`models`: v2 §7 lets apps compose tier packages.
- `packages/client/src/__tests__/browser-safe.spec.ts` importing wire: deliberate guard.
- Terminal not-found: API matches `ECallFailure.NotFound` since 2026-11-23; daemon and fake messages are display text only.
- Error-string matches in `packages/db/src/pool.ts:91`: external APIs.
- `packages/plugin-sdk/src/memory.ts` duplicating the memory summary shape as string unions: structural, kept so plugins need no core enums.

## Log

### 2026-11-26

- Fixed: `packages/github` (v2 control plane) imported repo, device sign-in and PR stream vocabulary from v1 `@dltech/atlas-wire` in 9 files. Moved `GITHUB_REPO_PATTERN`/`GIT_BRANCH_PATTERN`, repo/branch schemas, `ERepoTracking`, repo summary, `ERepoTreeEntryKind` + repo tree, device codes + poll result, PR state/event/stream frame to `packages/core/src/github/{repo-vocabulary,device-connect,pr-stream}.ts`; wire re-exports them; github dropped its wire dependency.
- Pinned in `core/src/github/__tests__/vocabulary.spec.ts` (written against wire on main first, then moved) plus a wire/web identity check in `project-wire.spec.ts`. Mutations: non-int prNumber, tracking value, unvalidated default branch, optional missing scopes (each fails 1 core spec); wire keeps its own pattern copy (fails 1 wire spec).

### 2026-11-25

- Fixed: `packages/client/src/session/session-rewind.ts` typed restored composer images as v1 `SaidImageWire` from `@dltech/atlas-wire/web`. It now uses core `SaidImage`, which has the same shape. Client still depends on wire for `channel/*` (backlog 2).
- Pinned in `session-rewind.spec.ts`: an inline upload preview restores as an image, and an image with no size has no size keys. Mutations: always emit `width` (fails 1), drop the inline upload preview (fails 1).

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
