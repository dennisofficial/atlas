# Instruction audit

Checkable rules taken from the repo's instruction files (`AGENTS.md` = `CLAUDE.md`, `apps/*/AGENTS.md`,
`apps/web/CLAUDE.md` = its `AGENTS.md`, `packages/*/AGENTS.md`, `evals/**/AGENTS.md`). `deprecated/` is
out of scope. Layering/import boundaries belong to the Abstraction police routine; test conventions to
the Test audit routine. Rule list rebuilt 2026-11-25 after the v1 retirement edits (#2887–#2908, `packages/harness` deleted).

## Rules

| #   | Rule                                                                             | Source                                     | Check                                                                              |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------- |
| R1  | Max 300 lines per file (vendored `ui` files exempt)                              | `AGENTS.md:50`, `packages/ui/AGENTS.md:65` | `wc -l` over tracked `*.ts(x)` minus specs, fixtures, stories, generated, vendored |
| R2  | No `as any`, `@ts-ignore`, `@ts-expect-error`                                    | `AGENTS.md:46`                             | grep, ignoring generated, vendored and string fixtures                             |
| R3  | Value-union enums are `E`-prefixed                                               | `AGENTS.md:52`                             | grep `enum [^E]`                                                                   |
| R4  | No tsyringe decorators outside `apps/api`                                        | `AGENTS.md:58`                             | grep `@injectable(` / `@inject(`                                                   |
| R5  | No comments / no JSDoc on internal code                                          | `AGENTS.md:53`                             | grep `//`, `/**` in non-test source                                                |
| R6  | No npm/pnpm/yarn lockfiles                                                       | `AGENTS.md:100`                            | `git ls-files`                                                                     |
| R7  | `apps/api` app code never reads `process.env` (except `auth.server.ts`, loaders) | `apps/api/AGENTS.md:256`                   | grep                                                                               |
| R8  | Every `.prisma` model file starts `// use prisma-8`, one model per file          | `packages/db/AGENTS.md:13`                 | head/grep                                                                          |
| R9  | Every lexical language has `languages/__tests__/<ft>.spec.ts`                    | `packages/syntax/AGENTS.md:5`              | file listing                                                                       |
| R10 | Every `ui` component / AI pattern has a sibling `.stories.tsx`                   | `packages/ui/AGENTS.md:73`                 | `story-coverage.spec.ts`                                                           |
| R11 | `apps/api` has no tsconfig path aliases                                          | `apps/api/AGENTS.md:171`                   | grep `"paths"` in tsconfig                                                         |
| R12 | No `db.prisma`, no P2002/P2025 handling; queries go through `db.orm.public`      | `packages/db/AGENTS.md:88`                 | grep                                                                               |
| R13 | No raw hex or arbitrary Tailwind value in `apps/web` screens                     | `packages/ui/AGENTS.md:53`                 | grep `#[0-9a-f]{3,8}` and `-\[` in `className`                                     |
| R14 | Only `lucide-react` icons, no Radix                                              | `packages/ui/AGENTS.md:140`                | grep deps                                                                          |
| R15 | Stories import from `@storybook/react`, never a framework package                | `packages/ui/AGENTS.md:135`                | grep `*.stories.tsx`                                                               |
| R16 | TUI: no inline `content={new StyledText(` ; clickables use `useClickRegion`      | `apps/tui/AGENTS.md:5,20`                  | grep                                                                               |
| R17 | Every `packages/*`, `plugins/*`, `commands/` has a template `README.md`          | `AGENTS.md:43`                             | `bun scripts/check-package-readmes.ts`                                             |
| R18 | Mobile: native stack header, no custom `header`, no JS back button on iOS        | `apps/mobile/AGENTS.md:9,17`               | grep `header:`, `BackButton`, `router.back()` in `apps/mobile/src`                 |
| R19 | Mobile: no hard-coded status bar or notch size                                   | `apps/mobile/AGENTS.md:29`                 | grep numeric `top`/`paddingTop` insets                                             |
| R20 | Every `apps/api` env schema key has a line in every tier file                    | `apps/api/AGENTS.md:252`                   | diff Joi keys in `sections/*.ts` against `.env.*.enc` keys                         |
| R21 | No `.prisma` contract file declares the `v1_archive` schema                      | `packages/db/AGENTS.md:110`                | grep `v1_archive` in `*.prisma`                                                    |
| R22 | Mobile: loading uses `Spinner`, never `ActivityIndicator`                        | `apps/mobile/AGENTS.md:7`                  | grep `ActivityIndicator` in `apps/mobile/src`                                      |
| R23 | Mobile: bar colours only via `barHeaderOptionsOf`, no plain `headerStyle` colour | `apps/mobile/AGENTS.md:56`                 | grep `headerStyle` outside `src/navigation/glass-header.ts`                        |

R3, R4, R6, R8–R12, R14–R16 measured clean 2026-11-20. R17 clean 2026-11-24 (45 packages). R19 clean 2026-11-24.
R21 clean 2026-11-25. R18, R22, R23 clean 2026-11-27. R13: 0 raw hex, 105 arbitrary-value `className` hits in `apps/web/src` (stories included).

## Backlog (ranked)

1. R7 — remaining `process.env` reads in `apps/api` app code: `src/agent/config/env.ts:69` (default parameter) via 3
   lazy callers that open their own pool off module-level singletons: `instructions.ts:56`, `session-data.ts:36`,
   `mcp-servers.ts:158` (built in `registered-plugins.ts:63-77,138`, so the env must reach `pluginsOf`; snag:
   `registeredPlugins` at `:205` is built with no env, for event schemas only). Then `src/_lib/version/api-version.ts:17`
   (`ATLAS_APP_VERSION`, analytics singleton outside DI) and `src/_core/config/env/env.module.ts:15` (`NODE_ENV`).
2. R20 — schema keys with no tier line: `ARTIFACT_DOMAIN` (`sections/artifacts.ts:13`), `CHANGES_S3_BUCKET`,
   `CHANGES_S3_PREFIX`, `CONTEXT_S3_PREFIX`, `CHANGES_GC_GRACE_MS` (`sections/changes.ts:11,12,15,18`), `EMAIL_FROM`
   (`sections/email.ts:10`), `PREVIEW_DOMAIN` (`sections/cloudflare.ts:14`). Needs the decrypt key to add lines.
3. R13 — triage the 105 arbitrary values in `apps/web/src`; e.g. `features/sessions/panel/details/rows.tsx:14,16,23`.
4. R1 — 49 production source files over 300 lines (2026-11-25). Largest: `packages/control/src/control-plane.ts`,
   `packages/control/src/postgres/postgres-store.ts`, `packages/protocol/src/api.ts`. One split per run.
5. R5 — comment lines in ~430 package source files; pick per-file alongside R1 splits.

## Ruled out

- R1 for `packages/db/migrations/**`, `packages/db/.agents/skills/**`, `*.generated.ts`, `contract.d.ts`,
  `apps/*/prototype/**`, `**/spikes/**`, `apps/*/scripts/**`: generated, vendored or throwaway.
- R2 hits in `packages/api-router/src/generated/**`, `packages/db/.agents/**`, JSON/string fixtures.
- R7 for `src/api/hydrate-env.ts` and `_core/config/env/validated-env.ts` (default source): they load or validate
  `process.env` before anything validated exists. `apps/api/AGENTS.md:256` lists the loaders.
- R7 for `src/agent/testing/*`: child-process test rigs configured through env by their specs.
- `apps/tui` import list (`AGENTS.md:36`, `apps/tui/AGENTS.md:27`): a boundary rule, owned by Abstraction police and
  enforced by `apps/tui/src/__tests__/package.spec.ts`.

## Runs

### 2026-11-27

- Instruction edits since 2026-11-26: root `AGENTS.md` (CI shards, ruleset ban: process rules, not code), `apps/mobile`
  (native bars, tabs, glass) and `packages/ui` (button disabled colours, measured clean). Added R22, R23 (clean).
- R18 backlog item gone: the JS `BackButton` was removed by the mobile tab work; `router.back()` now only closes modals.
- Fixed R7 for `operatorRequestRegistry` (`config/operator-control.ts`): it takes the host env, and `HostCallsModule`
  injects `AGENT_HOST_ENV`; the module-level cache is gone (the Nest factory is the single owner). Pinned on main via
  `process.env` in `database-ports-env.spec.ts`; 3 mutations (`process.env`, `readAgentHostEnv()`, literal URL) failed.
- `src/agent/{config,operator-input,host}`: the same 12 Postgres-only specs fail on clean main here.

### 2026-11-26

- Instruction edits since 2026-11-25 (`packages/db`, `evals`, `apps/mobile` AGENTS.md) are prose: access grants,
  project groups, `eval:jev-real`, Hermes source maps. Nothing new to measure; rule list unchanged.
- Fixed R7 for 5 of the 9 lazy `readAgentHostEnv()` callers: `accessSourceOf`, `cloudConfigStore`,
  `envSecretsReader`, `projectFilesSourceOf`, `mcpControlPort` now take the host env from `composeAgentHost`.
  `database-ports-env.spec.ts` pins that each opens the env's database (an insecure-URL error names the host);
  pinned on main via `process.env` first; 5 mutations back to `process.env` each failed, restored byte for byte.
- `src/agent/config` + `src/agent/__tests__`: the same 15 specs fail on clean main here (no Postgres/Redis).

### 2026-11-25

- Rebuilt the rule list after the v1 retirement edits: added R21 (`v1_archive` stays out of the contract, clean);
  dropped the deleted `packages/harness` prompt file; re-anchored R1/R7/R20. R1 down to 49 files.
- Fixed R7 for `JINA_API_KEY` (`agent/registered-plugins.ts:183`, added by #2852): `AgentHostEnv.jinaApiKey` carries
  it and `composedPluginsOf(env)` builds the web pod from it in `compose.ts` and `control.module.ts`. Pinned the
  bearer and the no-key answer on main first; 3 mutations failed, restored. Added the row to `src/agent/AGENTS.md`.

### 2026-11-24

- Rebuilt the rule list: added R18–R19 from the new `apps/mobile/AGENTS.md` and R20 (tier lockstep). Other edits
  since 2026-11-23 are the TUI boundary (Abstraction police) and deploy prose.
- Fixed R7 for `GITHUB_SWEEPS_IN_PROCESS`: `GithubSweepSchedulerService` reads it through `EnvService` and owns its
  `setInterval`s on bootstrap/shutdown, so `@nestjs/schedule` and the import-time gate are gone. Pinned cadence,
  gate, shutdown and error survival with fake timers on main first; 7 mutations each failed, then restored.
- Clean main and the branch both fail the same 57 `cloud/github` specs here (no Postgres on :55441).

### 2026-11-23

- Rebuilt the rule list: added R17 (package READMEs, clean). Other instruction edits since 2026-11-20 are prose
  (glossary names, Vercel platform account, Agent37 disk) with nothing new to measure.
- Fixed R7 for `DATABASE_URL` in `sandbox-principal-revocations.ts:20`: `SandboxesService` now takes `EnvService`
  and hands the URL to `PrincipalRevocations`. New revocation spec counts `pg_stat_activity` listeners; proved it
  fails with the URL read from `process.env` and with `undefined`, then restored.
- Clean main fails ~470 `apps/api` specs in this sandbox (no Redis); CI is the full-suite gate.
- Follow-up on Dennis's ask: `validatedEnvService()` (`_core/config/env/validated-env.ts`) replaces
  `validate-environment.ts` and `workerEnvService()`; `main.ts` reads `PORT` through it. Dennis approved listing the
  two loaders in `apps/api/AGENTS.md:293`.

### 2026-11-20

- Rebuilt the rule list (R11–R16 added) after #2425/#2467 rewrote the instruction files. `CLAUDE.md` and
  `apps/web/CLAUDE.md` are byte copies of their `AGENTS.md`.
- Fixed R7 for `GITHUB_API_URL`: no tier, deploy target or script set it; only `github-head-reads.spec.ts`
  did. The four GitHub read classes now use `GITHUB_API` from `github-user-http.ts`; the spec stubs `fetch`.
  Pinned URLs with `github-user-reads.base-url.spec.ts`; proved the pins fail by changing `GITHUB_API`.

### 2026-11-19

- Built the rule list (R1–R10) from all 12 instruction files. R3, R4, R6, R8, R9, R10 clean.
- Fixed R2: the only `as any` in the repo, `apps/tui/scripts/proto-shimmer.tsx:260`, now builds a typed
  `ToolCall` (its literal was a stale shape with `settled`/`failed` fields). Proved the type check bites
  by setting `state: 'ok'` (TS2322), then restored.
