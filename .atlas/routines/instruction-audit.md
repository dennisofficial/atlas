# Instruction audit

Checkable rules taken from the repo's instruction files (`AGENTS.md` = `CLAUDE.md`, `apps/*/AGENTS.md`,
`apps/web/CLAUDE.md` = its `AGENTS.md`, `packages/*/AGENTS.md`, `evals/**/AGENTS.md`). `deprecated/` is
out of scope. Layering/import boundaries belong to the Abstraction police routine; test conventions to
the Test audit routine. Rule list rebuilt 2026-11-23 after #2538 (package READMEs) and #2503/#2569/#2571 edits.

## Rules

| #   | Rule                                                                               | Source                                     | Check                                                                              |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------- |
| R1  | Max 300 lines per file (vendored `ui` files exempt)                                | `AGENTS.md:45`, `packages/ui/AGENTS.md:65` | `wc -l` over tracked `*.ts(x)` minus specs, fixtures, stories, generated, vendored |
| R2  | No `as any`, `@ts-ignore`, `@ts-expect-error`                                      | `AGENTS.md:46`                             | grep, ignoring generated, vendored and string fixtures                             |
| R3  | Value-union enums are `E`-prefixed                                                 | `AGENTS.md:52`                             | grep `enum [^E]`                                                                   |
| R4  | No tsyringe decorators outside `apps/api`                                          | `AGENTS.md:58`                             | grep `@injectable(` / `@inject(`                                                   |
| R5  | No comments / no JSDoc on internal code                                            | `AGENTS.md:53`                             | grep `//`, `/**` in non-test source                                                |
| R6  | No npm/pnpm/yarn lockfiles                                                         | `AGENTS.md:100`                            | `git ls-files`                                                                     |
| R7  | `apps/api` app code never reads `process.env` (except `main.ts`, `auth.server.ts`) | `apps/api/AGENTS.md:291`                   | grep                                                                               |
| R8  | Every `.prisma` model file starts `// use prisma-8`, one model per file            | `packages/db/AGENTS.md:13`                 | head/grep                                                                          |
| R9  | Every lexical language has `languages/__tests__/<ft>.spec.ts`                      | `packages/syntax/AGENTS.md:5`              | file listing                                                                       |
| R10 | Every `ui` component / AI pattern has a sibling `.stories.tsx`                     | `packages/ui/AGENTS.md:73`                 | `story-coverage.spec.ts`                                                           |
| R11 | `apps/api` has no tsconfig path aliases                                            | `apps/api/AGENTS.md:171`                   | grep `"paths"` in tsconfig                                                         |
| R12 | No `db.prisma`, no P2002/P2025 handling; queries go through `db.orm.public`        | `packages/db/AGENTS.md:88`                 | grep                                                                               |
| R13 | No raw hex or arbitrary Tailwind value in `apps/web` screens                       | `packages/ui/AGENTS.md:53`                 | grep `#[0-9a-f]{3,8}` and `-\[` in `className`                                     |
| R14 | Only `lucide-react` icons, no Radix                                                | `packages/ui/AGENTS.md:140`                | grep deps                                                                          |
| R15 | Stories import from `@storybook/react`, never a framework package                  | `packages/ui/AGENTS.md:135`                | grep `*.stories.tsx`                                                               |
| R16 | TUI: no inline `content={new StyledText(` ; clickables use `useClickRegion`        | `apps/tui/AGENTS.md:5,20`                  | grep                                                                               |
| R17 | Every `packages/*`, `plugins/*`, `commands/` has a template `README.md`            | `AGENTS.md:43`                             | `bun scripts/check-package-readmes.ts`                                             |

R3, R4, R6, R8–R12, R14–R16 measured clean 2026-11-20. R17 clean 2026-11-23 (45 packages). R13: 0 raw hex,
105 arbitrary-value `className` hits in `apps/web/src` (stories included).

## Backlog (ranked)

1. R7 — remaining `process.env` reads in `apps/api` app code: `src/api/cloud/github/github-sweep-scheduler.ts:14`
   (`GITHUB_SWEEPS_IN_PROCESS`; decides Nest providers at decoration time, needs a module factory),
   `src/_lib/version/api-version.ts:10` (`ATLAS_APP_VERSION`), `src/_core/config/env/env.module.ts:15` (`NODE_ENV`),
   `src/agent/config/env.ts:67` (default parameter), `src/agent/testing/*` (test rigs; candidate for ruled-out).
2. R13 — triage the 105 arbitrary values in `apps/web/src`; e.g. `features/sessions/panel/details/rows.tsx:14,16,23`
   (`text-[11px]`). Separate stories (layout frames) from screens before fixing.
3. R1 — 75 production source files over 300 lines. Largest: `packages/core/src/settings/registry.ts`,
   `packages/control/src/control-plane.ts`, `packages/control/src/postgres/postgres-store.ts`. One split per run.
4. R5 — comment lines in ~430 package source files; pick per-file alongside R1 splits.

## Ruled out

- R1 for `packages/db/migrations/**`, `packages/db/.agents/skills/**`, `*.generated.ts`, `contract.d.ts`,
  `apps/*/prototype/**`, `**/spikes/**`, `apps/*/scripts/**`: generated, vendored or throwaway.
- R2 hits in `packages/api-router/src/generated/**`, `packages/db/.agents/**`, JSON/string fixtures.
- R7 for `src/api/hydrate-env.ts` and `src/trigger/tier-env.ts`: they decrypt the tier into `process.env`, so
  nothing validated exists yet. `apps/api/AGENTS.md:293` lists them since #2694.
- `packages/harness/src/prompt/AGENTS.md`: nothing mechanically checkable.

## Runs

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
