# Abstraction police

## Backlog (ranked)

1. `packages/sandbox` (used by v2 `apps/daemon`) imports v1 `mirrorsThreadState` from `@dltech/atlas-wire` (`serve-priority.ts:4`, `workload-cgroups.ts:4`, `workload-priority.ts:1`). Move the env predicates (`writesBehind`, `isLocalPod`, `isApiProvisioned`, their env names) to `core` or `sandbox/markers.ts`; wire re-exports.
2. `apps/api/src/api/platform/control/terminal.service.ts:26,228` branches on the daemon's error text `no terminal ` (`apps/daemon/src/ops/terminal/pty.ts:35`, copy in `packages/protocol/src/testing/fake/terminal.ts:18`). Add a typed code to the terminal-read reply in `protocol`.
3. `packages/plugin-sdk` type-depends upward on `agent` (`slots.ts:1`, `compose-pod.ts:1`), `client/transcript` (`slots.ts:2`), `control` (`slots.ts:12`). Move the shapes down or make slots generic.
4. `packages/client/src/channel/*` (~15 files) and `transcript/events-from-wire.ts` import `@dltech/atlas-wire/web`. Retarget onto `protocol` or split out a v1-compat module. Large.
5. `apps/tui` imports `@dltech/atlas-wire` in 12 production files (e.g. `cloud/dev-serve.ts:5`, `push/push-text.ts:1`). v1-only, deleted with v1 — low value.
6. `packages/api-router/src/generated/server.ts:16` pulls ~200 wire schemas; follows the API routes, moves with v1 deletion.
7. Test-only deep relative imports across package roots: `apps/serve/src/__tests__` → `packages/harness/src`, `apps/api` specs → `packages/api-router/src/generated/server`, `apps/tui/scripts`, `apps/mac/scripts/pack-host.ts:4`. Add `exports` subpaths.
8. `packages/host/__tests__/remote-calls-real.spec.ts:7` imports app `@dltech/atlas-daemon/testing`.

## Ruled out

- `packages/core` purity, `packages/ui` Atlas imports, plugin→plugin imports, clients importing `apps/api`: all clean (2026-11-19 sweep).
- `apps/tui` importing `core`/`client`/`observability`/`syntax`/`models`: v2 §7 lets apps compose tier packages.
- `packages/client/src/__tests__/browser-safe.spec.ts` importing harness/wire: deliberate guard.
- `apps/api` → `harness`, `harness` → `agent-v1`: v1-internal.
- Error-string matches in `packages/db/src/pool.ts:91`, harness `docker-process.ts`, `cloud-birth.ts`: external APIs.

## Log

### 2026-11-19

- Fixed: `plugins/memory` pod tools imported memory vocabulary (`EMemoryScope`, `EMemoryType`, name pattern, size limits) from v1 `@dltech/atlas-wire`. Moved it to `packages/core/src/memory/vocabulary.ts`; wire re-exports it; plugin dropped its wire dependency.
- Pinned `write_memory` limits (body 20000, description 300, type and scope enums) in `plugins/memory/src/pod/__tests__/tools.spec.ts`; the new specs pass on main and on the branch.
