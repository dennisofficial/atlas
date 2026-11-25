# v1 retirement: dependency inventory

Repo: `/atlas/workspaces/atlas/.atlas/worktrees/dennis/v1-retirement-spec` (origin/main, 2026-11-24).
Read-only survey. Every anchor below was read in this checkout.

Definitions used here:
- **v1 tree** = `packages/harness`, `packages/agent-v1`, `apps/serve`.
- **v2 tree** = `apps/api` (control plane), `packages/agent`, `packages/host`, `apps/daemon`, `plugins/*`.
- `packages/wire` is **not** v1. It is shared: 267 named imports in `apps/api`, 375 in `apps/web`
  (`@dltech/atlas-wire/web`), 9 in `packages/github`, 2 in `apps/trigger`.

Sizes (`.ts` / `.tsx` under `src`):

| tree                    | files              | lines                      |
| ----------------------- | ------------------ | -------------------------- |
| `packages/harness/src`  | 2131               | 254,446                    |
| `apps/serve/src`        | 365                | 45,007 (202 of them specs) |
| `packages/agent-v1/src` | 87                 | 7,137                      |
| `packages/wire/src`     | 163 (100 non-test) | —                          |

## 1. Who depends on the v1 packages

### 1.1 Manifest-level (`workspace:*`) vs real imports

Counts are **named import specifiers** (`from '…'`, `import('…')`), excluding `package.json`,
`deprecated/` and `evals/datasets`.

| target                                           | real importers (specifier count)                                                                                                                                                                                                                                                                     | package.json-only (stale)                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `@dltech/atlas-harness`                          | `apps/serve` 292, `packages/harness` 18 (self/fixtures), `apps/mac` 11, `packages/client` 1 (negative test)                                                                                                                                                                                          | `apps/web/package.json:19`, `evals/package.json:23` |
| `@dltech/atlas-harness/activity`                 | `apps/serve` 9                                                                                                                                                                                                                                                                                       | —                                                   |
| `@dltech/atlas-agent-v1`                         | `packages/harness` 52                                                                                                                                                                                                                                                                                | none                                                |
| `@dltech/atlas-serve` (app name of `apps/serve`) | none (nothing imports the app)                                                                                                                                                                                                                                                                       | —                                                   |
| `@dltech/atlas-wire`                             | shared, not v1: `apps/api` 267, `packages/harness` 170, `apps/serve` 128, `packages/github` 9, `apps/mac` 5, `apps/trigger` 2, `packages/api-router` 1, `packages/client` 1, `apps/mobile` 1 (`/web` subpath: `apps/web` 375, `packages/client` 31, `apps/api` 27, `apps/mobile` 10, `apps/serve` 2) | —                                                   |

Notes on the numbers:
- `apps/serve` imports harness in **219 source files**; `apps/serve` is the only real consumer of
  `@dltech/atlas-harness/activity` (`apps/serve/src/index.ts`, boot/reporter modules).
- `packages/client/src/__tests__/browser-safe.spec.ts:23` is the single `packages/client` hit: it
  asserts that a harness import is rejected. It survives the deletion as a one-line fixture string.
- `apps/web` declares harness at `apps/web/package.json:19` and lists it in
  `apps/web/next.config.ts:47` (`transpilePackages`), asserted by
  `apps/web/__tests__/next-config.spec.ts:29`. **No `apps/web/src` file imports it.** Both entries
  are stale and must be removed or the Next build keeps compiling a package that no longer exists.
- `evals/package.json:23` declares harness; `evals/src`, `evals/code-quality`, `evals/__fixtures__`
  contain no harness import. Stale.
- `packages/core/src/version/__tests__/release-affected.spec.ts:12-13,20,28` names
  `@dltech/atlas-harness` and `apps/serve` as release-affecting dependencies of `apps/tui` and of
  itself. This is a version-graph fixture, not an import; it will need rewriting when the packages go.
- `packages/ui/src/ai/message-response.stories.tsx:22` mentions harness only inside a markdown string.

### 1.2 Config files that name v1 by path

- `tsconfig`: **no** `tsconfig*.json` in the repo references `atlas-harness`, `agent-v1`,
  `atlas-serve` or `atlas-wire` (resolution is workspace symlinks; `tsconfig.base.json` has no
  `paths`). Nothing to clean.
- `bunfig.toml`: no preload references any v1 package. `packages/harness/bunfig.toml` and
  `apps/serve/bunfig.toml` preload their own `test-home-setup.ts`; both files disappear with their
  packages.
- `turbo.json`: no package lists (generic `typecheck`/`test`/`build`, `dependsOn: ["^task"]`).
  Nothing to edit; turbo discovers packages by manifests.
- `biome.json`: no per-package paths beyond formatting scope; nothing v1-specific found.
- No knip / dependency-cruiser / madge config exists (root has only `biome.json`, `lefthook.yml`,
  `tsconfig.base.json`).

## 2. Package-by-package classification

| path                     | what it is                                                                                                            | who imports it (real imports)                                                                             | classification                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `packages/harness`       | v1 harness: loop composition, plugins, tools, store, cloud bridge, pod-thread, settings                               | `apps/serve` 292, `apps/mac` 11                                                                           | **v1** (with an `apps/mac` tail, see §2.1)                                                |
| `packages/agent-v1`      | v1 turn loop: `loop/`, `intake/`, `tools/`, `hooks/`, `ledger/`, `model/`, `trace/`, `testing/` (`src/index.ts:1-59`) | `packages/harness` 52 (plus a type-only re-export into the store)                                         | **v1 only**                                                                               |
| `apps/serve`             | per-sandbox server; `src/main.ts:1,10` boots `startServe()` and `runSupervisorCli`                                    | nothing imports it; it is a released binary                                                               | **v1 only**                                                                               |
| `packages/wire`          | zod wire frames for API ↔ client ↔ pod                                                                                | api 267, web 375, harness 170, client 31, github 9, mobile 10, trigger 2, mac 5, api-router 1             | **shared, keep**                                                                          |
| `packages/credentials`   | provider key path + OAuth flows + `./usage`                                                                           | api 8 + `/provider-oauth` 4 + `/usage` 1, models 1, control 1, harness 9+2                                | shared (v2 owns `provider-oauth`, `usage`)                                                |
| `packages/sandbox`       | cgroup CPU/memory priority for one pod (README says "`apps/daemon`, `apps/serve` and `packages/harness` call it")     | `apps/daemon` 7, harness 3                                                                                | **v2 survives**                                                                           |
| `packages/pods`          | sandbox providers, 37 deep subpaths                                                                                   | `apps/api` 85, `apps/trigger` 15                                                                          | v2 only                                                                                   |
| `packages/commands`      | command contract: spec, registry, catalogue, parser                                                                   | commands/ 28, host 20, web 18, tui 17, api 13, mobile 11, plugin-sdk 5, plugins 17, protocol 1, control 1 | shared, keep                                                                              |
| `packages/memory`        | user memory rows                                                                                                      | `apps/api` 2                                                                                              | v2 only                                                                                   |
| `packages/github`        | GitHub domain package                                                                                                 | `apps/api` 307+47, `apps/trigger` 2                                                                       | v2 only                                                                                   |
| `packages/previews`      | Cloudflare tunnel per pod                                                                                             | `apps/api` 8, `apps/trigger` 4                                                                            | v2 only                                                                                   |
| `packages/classifier`    | decision-model role                                                                                                   | `apps/api` 5, `apps/web` 1                                                                                | v2 only                                                                                   |
| `packages/jobs`          | trigger task ids and payload schemas                                                                                  | `apps/trigger`, `apps/api`, `packages/pods`                                                               | v2 only                                                                                   |
| `packages/media`         | media helpers                                                                                                         | `apps/api` 11+7, `apps/trigger` 1                                                                         | v2 only                                                                                   |
| `packages/schedule`      | schedule helpers                                                                                                      | `apps/web` 5, `apps/trigger` 3, `packages/control` 1                                                      | v2 only                                                                                   |
| `packages/artifacts`     | artifact format + storage keys; exports `.` and `./node`                                                              | `apps/api` 15, harness 6, `apps/artifacts-host` 4                                                         | shared; `./node` has **no importer anywhere** — candidate dead subpath, not a v1 casualty |
| `packages/control`       | control plane (postgres, s3, testing)                                                                                 | api 79, host 71, trigger 8, github 6, pods 6, plugins 2                                                   | v2 only                                                                                   |
| `packages/host`          | v2 pod host                                                                                                           | `apps/api` 83, `packages/pods` 4                                                                          | v2 only                                                                                   |
| `packages/ui-native`     | React Native components; "`apps/mobile` is the only consumer" (README)                                                | `apps/mobile` 61                                                                                          | mobile only                                                                               |
| `packages/plugin-sdk`    | v2 plugin contract + composer                                                                                         | host 68, plugins/* 148, api 15, pods 3, tui/web/mobile 1 each                                             | v2 only                                                                                   |
| `packages/client`        | client-side channel/transcript/session runtime                                                                        | web 176, tui 128, mobile 49, harness 30, plugins 8                                                        | shared; `./channel-fixture` (12 of its 13 importers are harness) is largely v1-supporting |
| `packages/api-router`    | generated `AppRouter` + `createApiClient`                                                                             | harness 28, mobile 11, web 7, tui 4, mac 3                                                                | shared, keep                                                                              |
| `packages/models`        | model catalogue + provider adapters                                                                                   | harness 25, api 14, control 7, web 6, tui 4                                                               | shared, keep                                                                              |
| `packages/observability` | OTel wiring                                                                                                           | api 98, host 74, harness 70, agent 24, agent-v1 16, serve 7, trigger 4, tui 3                             | shared, keep                                                                              |
| `packages/core`          | pure domain core                                                                                                      | everything                                                                                                | shared, keep                                                                              |
| `packages/protocol`      | protocol schemas                                                                                                      | api 155, web 121, host 87, tui 70, daemon 54, …                                                           | shared, keep                                                                              |
| `apps/webterm`           | dev-only remote terminal for this repo's own checkout; no workspace deps                                              | nothing                                                                                                   | survives untouched                                                                        |
| `apps/prototype`         | clickable design prototype of `apps/web`; only `@dltech/atlas-ui`                                                     | nothing                                                                                                   | survives untouched                                                                        |
| `apps/daemon`            | v2 pod daemon                                                                                                         | `apps/api` 3, `packages/host` 2 (exports `./testing`, 2 api + 1 host)                                     | v2 only                                                                                   |
| `apps/mac`               | Mac app + local pod host                                                                                              | —                                                                                                         | **mixed, see §2.1**                                                                       |
| `apps/web`               | web client                                                                                                            | —                                                                                                         | v2; stale harness manifest entry only                                                     |

### 2.1 The one real problem: `apps/mac` imports harness

`apps/mac` is a v2 client (`@dltech/atlas-api-router`, `@dltech/atlas-wire`,
`@dltech/atlas-protocol/mac-link`), but its local-pod host is built on harness modules:

| file:line                                                                           | imports from `@dltech/atlas-harness`                                                                                                                                  |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/mac/src/host/auth/token-store.ts:2`                                           | `FileSecretsStore`, `SecretCipher`                                                                                                                                    |
| `apps/mac/src/host/pods/service.ts:2-10`                                            | `atlasDirectory`, `DEFAULT_DOCKER_SOCKET`, `ECloudSandboxState`, `createLocalPodBridge`, `pingDocker`, `sandboxServeTokenFor`, `sandboxServeTokenName`, `CloudBridge` |
| `apps/mac/src/host/pods/config.ts:3`                                                | `PodBridgeDriver`, `PodDriverConfig`                                                                                                                                  |
| `apps/mac/src/host/pods/pod-threads.ts:3-11`                                        | `assemblePodThread`, `NoLocalPodCopyError`, `openParkedPodThread`, `UnavailableSessionActivity`, `CloudBridge`, `CloudChannel`, `PodThread`, `PodThreadPorts`         |
| `apps/mac/src/host/pods/thread-reads.ts:2`                                          | `createLocalPodTitles`, `listLocalPodThreads`, `wireEventOf`                                                                                                          |
| `apps/mac/src/host/pods/local-store.ts:6-14`                                        | `FileThreadReadCursor`, `JsonlEventLog`, `JsonlThreadStore`, `JsonlTurnLedger`, `RandomIds`, `SecretCipher`, `SystemClock`, `registryFor`                             |
| `apps/mac/src/host/pods/pod-records.ts:9`                                           | `listLocalPodThreads`, `registryFor`, `ThreadSummary`                                                                                                                 |
| `apps/mac/src/host/pods/lease.ts:2`                                                 | `PodLeaseRegistrar`                                                                                                                                                   |
| `apps/mac/src/host/pods/__tests__/{pods-host-fixture,pod-threads,thread-routes}.ts` | `PodBridgeDriver`, `createLocalPodBridge`, `EThreadTitleSource`, `FileLocalThreadTitles`                                                                              |

Where those symbols live in harness:

`secrets/file-secrets-store.ts`, `credentials/secret-cipher.ts`, `cloud/local-pod-bridge.ts`,
`cloud/local-pod-bridge-options.ts` (`PodBridgeDriver`, `PodLeaseRegistrar`),
`cloud/cloud-bridge.ts` (`CloudBridge`, `ECloudSandboxState`), `cloud/sandbox-client.ts`,
`cloud/sandbox-attachment.ts` (`sandboxServeTokenFor`, `sandboxServeTokenName`),
`cloud/session-wire.ts` (`wireEventOf`), `pod-thread/pod-thread.ts:68` (`assemblePodThread`),
`pod-thread/pod-thread-parked.ts:14` (`openParkedPodThread`), `pod-thread/local-pod-titles.ts:120`,
`store/index.ts` (Jsonl stores, ids, clock, registry, `atlasDirectory`, `EThreadTitleSource`,
`FileLocalThreadTitles`), `store/sessions/listing-local.ts:11` (`listLocalPodThreads`),
`ledger/index.ts`, `execution/docker/sandbox.ts` (`DEFAULT_DOCKER_SOCKET`), `index.ts` (`pingDocker`).

How deep it goes: tracing relative imports from exactly those seed modules reaches **298 of
harness's 2131 files** across `store` (48), `cloud` (44), `model` (32), `services` (25), `shells`
(20), `agents` (16), `loop` (14), `execution` (14), `activity` (12), `pod-thread` (11), `workspace`,
`ledger`, `files`, `composition` (5), `intake`, `pending`, `skills`, `channel`, `tools`, `hooks`,
`providers`, `credentials`, `wake`, `secrets`, `operator-input`, `container`, `power`, `rotation`.
That closure still imports **`@dltech/atlas-agent-v1` in 25 places** (plus `atlas-wire` 36,
`atlas-sandbox` 2, `atlas-api-router` 2, `atlas-observability` 14, `atlas-client/*` 11).
So "delete harness, keep the Mac local-pod path" is not a free cut: the Mac path drags the v1
loop and the v1 composition (`composition/`) with it. Also note the Mac app imports the **barrel**
(`@dltech/atlas-harness` → `packages/harness/src/index.ts:1-151`, which re-exports
`./composition`, `./plugins`, `./tools`, …), so today it loads all of v1 at module scope.

## 3. Does v2 reach into harness?

No.
- `packages/agent`, `packages/core`, `packages/host`, `packages/control`, `packages/protocol`,
  `packages/pods`, `apps/daemon`, `packages/db`, `packages/github`, `apps/trigger`, `plugins/*`,
  and everything under `apps/api/src` contain **zero** `@dltech/atlas-harness` imports.
- Enforced in code: `apps/api/src/api/harness-boundary.spec.ts:22-30` walks all of `apps/api/src`
  and fails on any harness specifier. The split guard (§5) covers `packages/agent`,
  `packages/host`, `packages/control`, `packages/protocol`, `apps/api/src/agent`,
  `apps/api/src/api/cloud/agent-host`, `apps/daemon`.
- The dependency direction is the opposite: harness **re-exports** v2 packages —
  `packages/harness/src/index.ts:3-9` re-exports `CatalogueProvider`/`unanswerableRef`/
  `unmeasuredWindowWarning` from `@dltech/atlas-models` and `EDevicePoll` from
  `@dltech/atlas-credentials/provider-oauth`.
- Shared behaviour is duplicated, not imported: `docs/handoffs/slice-4.md:49` states "v1 and v2
  share no logic. v1 has its own copy of the loop (`packages/agent-v1`)".

### Settings definitions: where the non-v1 rows live

- **v1-only rows** (the ones that go with harness):
  `packages/harness/src/settings/v1-only-definitions.ts` — 267 lines, exports
  `DEFAULT_CONTAINER_IDLE_MINUTES` and `V1_ONLY_SETTING_DEFINITIONS` (header comment at lines 24-27:
  "The rows only v1 reads… the v1 deletion (`packages/harness`) takes this list with it").
  Re-exported at `packages/harness/src/settings/index.ts:20`. Consumers are harness-internal only:
  `composition/settings-binding.ts:18`, `composition/sandbox-binding.ts:39`, plus 8 specs.
- **v2 rows** live in `packages/core/src/settings/cloud/`: `harness-settings.ts`
  (`HARNESS_SETTING_ENTRIES`, `ESettingConsumer.Harness`), `web-only-settings.ts`,
  `client-settings.ts`, `settings-registry.ts`, `setting-entry.ts` (`ESettingConsumer` at line 6,
  values `harness | api | none`), `setting-enums.ts`. `packages/wire/src/web/settings-registry.ts:1-14`
  is a pure re-export of those core exports to web clients.
- The setting **ids** themselves are declared once in core: `packages/core/src/settings/registry.ts:29`
  (`enum ESettingId`). Deleting v1 leaves the v1-only ids in that enum unused — prune them there, not
  in harness.

## 4. `apps/tui`: no v1 path left

- Manifest: `apps/tui/package.json` has no harness / agent-v1 / serve / wire dependency.
- `apps/tui/src/__tests__/package.spec.ts:5-20` — `ALLOWED` = `atlas-api-router`, `atlas-client`,
  `atlas-commands`, `atlas-core`, `atlas-models`, `atlas-notifications`, `atlas-observability`,
  `atlas-protocol`, `atlas-syntax`; plus `@dltech/atlas-plugin-*` slots `/client`, `/core` and
  `@dltech/atlas-plugin-sdk`.
- Failure modes it enforces: any dependency outside that list (:33-39), the strings
  `@dltech/atlas-harness`, `@dltech/atlas-wire`, `tsyringe`, `reflect-metadata` anywhere in the
  manifest (:41-53), and `FORBIDDEN_IMPORT` in `src` — that regex also bans `../composition`
  and `../../composition` (:24-26, :55-63).
- I found **no** engine switch, serve client, or wire usage in `apps/tui/src`: its cloud path goes
  through `@dltech/atlas-client/*` + `@dltech/atlas-api-router`, and its composition lives in
  `apps/tui/src/composition` (not harness's).
- Caveat: the guard is a text/regex test, so it proves absence of the import strings, not absence of
  a behavioural v1 path. Everything I read is v2-shaped, so treat TUI as clean.

## 5. `scripts/split-guard/rules.ts` — verbatim, scope, execution

Verbatim (lines 26-97):

```ts
export const SPLIT_RULES: readonly SplitRule[] = [
  {
    name: 'v2 must not depend on v1',
    roots: [
      'packages/agent',
      'packages/host',
      'packages/control',
      'packages/protocol',
      'apps/api/src/agent',
      'apps/api/src/api/cloud/agent-host',
      'apps/daemon',
    ],
    forbidden: [
      '@dltech/atlas-harness',
      '@dltech/atlas-wire',
      '@dltech/atlas-serve',
      '@dltech/atlas-agent-v1',
    ],
  },
  {
    name: 'v1 must not depend on v2',
    roots: ['packages/harness', 'packages/agent-v1', 'apps/serve'],
    forbidden: ['@dltech/atlas-agent', '@dltech/atlas-host', '@dltech/atlas-control'],
  },
  {
    name: 'the github domain package and the v2 trigger worker stay off nest and v1',
    roots: ['packages/github', 'apps/trigger'],
    forbidden: [
      '@nestjs/common',
      '@nestjs/core',
      '@nestjs/schedule',
      '@nestjs/throttler',
      'nestjs-trpc',
      '@dltech/atlas-harness',
      '@dltech/atlas-agent-v1',
      '@dltech/atlas-serve',
    ],
  },
  {
    name: 'the provider key path never depends on a model catalogue or a classifier',
    roots: ['packages/credentials'],
    forbidden: ['@dltech/atlas-models', '@dltech/atlas-classifier'],
  },
  {
    name: 'the classifier never depends on a model catalogue, a credential store or v1',
    roots: ['packages/classifier'],
    forbidden: ['@dltech/atlas-models', '@dltech/atlas-credentials', '@dltech/atlas-harness'],
  },
  {
    name: 'the quality review never depends on v1, a host, a classifier or a network client',
    roots: ['plugins/quality'],
    forbidden: [
      '@dltech/atlas-harness',
      '@dltech/atlas-agent-v1',
      '@dltech/atlas-host',
      '@dltech/atlas-classifier',
      '@dltech/atlas-models',
      '@dltech/atlas-credentials',
    ],
  },
  {
    name: 'the model catalogue never depends on the classifier',
    roots: ['packages/models'],
    forbidden: ['@dltech/atlas-classifier'],
  },
  {
    name: 'a plugin must not import another plugin',
    roots: ['plugins'],
    forbidden: [],
    forbids: importsAnotherPlugin,
  },
]
```

Coverage: `packages/agent`, `packages/host`, `packages/control`, `packages/protocol`,
`apps/api/src/agent`, `apps/api/src/api/cloud/agent-host`, `apps/daemon`, `packages/harness`,
`packages/agent-v1`, `apps/serve`, `packages/github`, `apps/trigger`, `packages/credentials`,
`packages/classifier`, `plugins/quality`, `packages/models`, `plugins` (all).

How it runs: `scripts/check-package-split.ts` — glob `{packages,apps,plugins}/*/**/*.{ts,tsx}`
(`:5`), `violationsOf` + `judge` against `scripts/split-guard/allowlist.ts`, exits 1 on a forbidden
or a stale allowlist entry, prints `package split: clean (N allowlisted offenders left)` (`:16-26`).
Invoked by the root `lint` script, `package.json:26`:
`biome ci . && bun scripts/check-wire-skew.ts && bun scripts/check-daemon-link-skew.ts && bun scripts/check-package-split.ts && bun scripts/check-envelope.ts && bun scripts/check-package-readmes.ts && bun scripts/check-api-image-context.ts`.
CI runs it in the `check` job at `.github/workflows/ci.yml:35` (`run: bun run lint`).

Consequences for the retirement: rules 1 and 2 become no-ops (their roots vanish); rules 3, 5, 6
keep only their _v1_ entries to delete (`@dltech/atlas-harness`, `@dltech/atlas-agent-v1`,
`@dltech/atlas-serve`, `@dltech/atlas-wire` in rule 1 — but note rule 1 also forbids
`@dltech/atlas-wire` for v2, which is **wrong today** only if a v2 root legitimately needs wire; the
survey shows none of those roots import wire, so leave that entry). `scripts/split-guard/__tests__/scan.spec.ts:30-31,56`
use `@dltech/atlas-agent-v1` and `@dltech/atlas-harness/titling` as fixture strings; they survive as
strings.

## 6. Root config, CI and generated-artifact wiring

- Root `package.json:6-12` workspaces: `packages/*`, `commands`, `plugins/*`, `apps/*`, `evals`.
  Removing packages needs no edit here. `package.json:26` lint chain (§5).
- `turbo.json:5-18`: generic tasks only; nothing names v1.
- `tsconfig.base.json`: no `paths`; per-package `tsconfig.json` files extend it and reference no v1
  package (grep over all `tsconfig*.json` returned nothing).
- `biome.json`: no v1 paths.
- No knip/import-graph config exists.

CI (`.github/workflows/ci.yml`):

| job                    | line           | v1 coupling                                                                                                                                                                                                                                                              |
| ---------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `check`                | 20, step at 35 | `bun run lint` → `check-package-split` among others                                                                                                                                                                                                                      |
| `binaries`             | 84             | `scripts/app-reach.ts --base … --app apps/tui --app apps/serve` (:113); `bun run build` + smoke run `./bin/atlas --version` in `apps/tui` (:116-123); **build serve binary** `bun run build:serve` in `apps/serve` (:129-131) and a `bun-linux-arm64` variant (:137-140) |
| `release`              | 402            | `apps/tui/scripts/build.ts` per target (:442-451) and **serve binaries** `bun run build:serve --target bun-linux-x64                                                                                                                                                     | arm64`in`apps/serve`(:453-463), sha256 sidecars, then`gh release create` |
| job`check` steps 62-75 | 62             | regenerates `packages/harness/src/plugin-types`, `packages/harness/src/plugins`, `packages/harness/src/skills` via `packages/harness` scripts and fails when they are stale                                                                                              |

Other workflows:
- `.github/workflows/claude-code-version.yml:32-33` runs
  `(cd packages/harness && bun run generate:claude-code-version)` and rewrites
  `packages/harness/src/providers/anthropic-subscription-attribution.ts`.
- `.github/workflows/sandbox-image.yml:70-73` carries a path-mapping comment rewriting
  `infra/sandbox-image/` → `apps/serve/sandbox-image/` for tree tags; verify the mapping still has a
  target before deleting the serve tree.
- `lefthook.yml:16-18`: pre-commit regenerates
  `packages/harness/src/plugin-types/plugin-types.generated.ts` when
  `packages/{core,wire,harness}/src/**/*.ts` change.
- `scripts/check-wire-skew.ts:3-5` diffs `packages/wire/src/channel-wire.ts` — wire is kept, so this
  script stays. `scripts/check-envelope.ts` lists
  `packages/harness/src/prompt/fragments/envelope-contract.ts` in `PROSE_MENTIONS`; that entry must
  be deleted with the file.

Build/release artefacts of the v1 tree (they must go together):
- `apps/serve/package.json` script `build:serve` → `apps/serve/scripts/build-serve.ts`, which imports
  `../../../packages/harness/scripts/generate-plugin-types`, `…/generate-skills`, and
  `…/packages/harness/src/shells/supervisor-bundle` (lines 5-7), and resolves `@vscode/ripgrep`
  through `packages/harness/package.json` (lines 26-28 comment, `stageVendoredRipgrep`).
- `apps/serve/src/main.ts:1` imports `runSupervisorCli` from the harness barrel — the serve binary IS
  a harness host, so the two packages can only be deleted as one change.
- Release assets `atlas-serve-linux-{x64,arm64}` are produced by `apps/serve` in CI; anything that
  downloads them (sandbox boot, `packages/wire/src/sandbox-serve-launch.ts`,
  `packages/wire/src/sandbox-serve-install.ts`, `scripts/mirror-release.ts`) becomes dead and must be
  removed in the same PR.

## 7. Delete / move / keep

Delete as one unit: `apps/serve`, `packages/harness`, `packages/agent-v1`
(≈2,580 files). They cannot be split: serve's entry point is harness's supervisor, serve imports
harness in 219 files, and harness imports agent-v1 in 52.

Stale references to remove even though the import is gone: `apps/web/package.json:19`,
`apps/web/next.config.ts:47`, `apps/web/__tests__/next-config.spec.ts:29`, `evals/package.json:23`,
`packages/core/src/version/__tests__/release-affected.spec.ts:12-13,20,28`,
`scripts/check-envelope.ts` (`PROSE_MENTIONS` harness entry),
`scripts/split-guard/rules.ts` v1 entries + `scripts/split-guard/allowlist.ts` entries,
CI steps `.github/workflows/ci.yml:62-75,113,129-140,453-463`,
`.github/workflows/claude-code-version.yml:32-33`, `lefthook.yml:16-18`.

Keep as-is (shared): `packages/wire`, `packages/client`, `packages/api-router`, `packages/core`,
`packages/protocol`, `packages/commands`, `packages/models`, `packages/credentials`,
`packages/observability`, `packages/sandbox`, `packages/artifacts`.

Dead-exports watchlist after the cut (exports whose only or main consumer is v1):

| export                                                                                          | v1 consumers | remaining consumers                                  |
| ----------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------- |
| `@dltech/atlas-client/channel-fixture`                                                          | harness 12   | `apps/web` 1                                         |
| `@dltech/atlas-credentials/usage`                                                               | harness 2    | `apps/api` 1                                         |
| `@dltech/atlas-sandbox`                                                                         | harness 3    | `apps/daemon` 7 (fine)                               |
| `@dltech/bun-test-shims`                                                                        | harness 1    | `apps/api` 30, `packages/github` 4 (fine)            |
| `@dltech/atlas-artifacts/node`                                                                  | none         | none anywhere — already dead, unrelated to v1        |
| `V1_ONLY_SETTING_DEFINITIONS`, `DEFAULT_CONTAINER_IDLE_MINUTES`                                 | v1 only      | none → delete                                        |
| `ESettingId` v1-only members (`TldrFooter`, `Editor`, `ProjectInstructions`, container limits…) | v1 only      | prune in `packages/core/src/settings/registry.ts:29` |

Move (the only non-deletable piece): what `apps/mac` needs from harness (§2.1) — `secrets/`,
`store/` (Jsonl stores, registry, ids, clock, local titles), `cloud/` local-pod bridge + sandbox
attachment, `pod-thread/`, `ledger/`, `activity/`, `execution/docker` bits. Its transitive closure is
298 harness files and still pulls `@dltech/atlas-agent-v1`, so either (a) carve a new package from
that closure and cut the agent-v1 imports, or (b) drop the Mac local-pod path in the same change.
Decide this before scheduling the deletion; it is the only real design decision in the cut.

## What I could not confirm

- Whether any _runtime_ path (as opposed to a source import) still reaches `apps/serve`, e.g. a
  released-bundle download in `packages/wire/src/sandbox-serve-launch.ts` machinery or
  `scripts/mirror-release.ts` asset names. I read only the module names and the CI asset steps, not
  the full download logic.
- Whether `apps/serve/sandbox-image/` exists — the repo has `infra/sandbox-image/` and only a rename
  comment in `sandbox-image.yml`; I did not trace the current image contents.
- Whether `packages/harness/src/plugins` and `src/skills` generated bundles are consumed by anything
  outside harness (they are harness-internal by name; I did not scan `apps/serve` for them).
- The exact symbol-level dead exports inside `packages/models`, `packages/observability` and
  `packages/client` after the cut: I counted importers, not per-export usage.
