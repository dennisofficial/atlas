# Instruction audit

Checkable rules taken from the repo's instruction files (`AGENTS.md`, `apps/*/AGENTS.md`,
`packages/*/AGENTS.md`, `evals/**/AGENTS.md`). `deprecated/` is out of scope. Layering/import
boundaries belong to the Abstraction police routine; test conventions to the Test audit routine.

## Rules

| #   | Rule                                                                               | Source                      | Check                                                                               |
| --- | ---------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------- |
| R1  | Max 300 lines per file                                                             | `AGENTS.md:45`              | `wc -l` over tracked `*.ts(x)`, minus specs, fixtures, stories, generated, vendored |
| R2  | No `as any`, `@ts-ignore`, `@ts-expect-error`                                      | `AGENTS.md:46`              | grep, ignoring prose in strings/comments                                            |
| R3  | Value-union enums are `E`-prefixed                                                 | `AGENTS.md:52`              | grep `enum [^E]`                                                                    |
| R4  | No tsyringe decorators outside `apps/api`                                          | `AGENTS.md:58`              | grep `@injectable(` / `@inject(`                                                    |
| R5  | No comments / no JSDoc on internal code                                            | `AGENTS.md:53`              | grep `//`, `/**` in non-test source                                                 |
| R6  | No npm/pnpm/yarn lockfiles                                                         | `AGENTS.md:100`             | `git ls-files`                                                                      |
| R7  | `apps/api` app code never reads `process.env` (except `main.ts`, `auth.server.ts`) | `apps/api/AGENTS.md` Env    | grep                                                                                |
| R8  | Every `.prisma` model file starts `// use prisma-8`, one model per file            | `packages/db/AGENTS.md`     | head/grep                                                                           |
| R9  | Every lexical language has `languages/__tests__/<ft>.spec.ts`                      | `packages/syntax/AGENTS.md` | file listing                                                                        |
| R10 | Every `ui` component / AI pattern has a sibling `.stories.tsx`                     | `packages/ui/AGENTS.md`     | file listing (also a spec)                                                          |

## Backlog (ranked)

1. R7 — `process.env` in `apps/api` app code outside the sanctioned files:
   `src/api/cloud/github/github-head-reads.ts:23`, `github-repo-reads.ts:53`,
   `github-required-checks-read.ts:21`, `github-user-http.ts:10` (`GITHUB_API_URL`, a test-only
   override), `github-sweep-scheduler.ts:14` (`GITHUB_SWEEPS_IN_PROCESS`),
   `src/_core/config/env/env.module.ts:15`, `src/agent/config/env.ts:76`. Fix: add both keys to
   `sections/github.ts` + tier files and read through `EnvService`.
2. R1 — 68 production source files over 300 lines. Largest: `packages/core/src/settings/registry.ts`
   (961), `packages/control/src/control-plane.ts` (620), `packages/control/src/postgres/postgres-store.ts`
   (541), `packages/protocol/src/api.ts` (538), `apps/tui/src/composition/use-accounts.ts` (517),
   `packages/harness/src/composition/compose.ts` (469), `apps/api/src/api/cloud/skills/skills.service.ts`
   (467), `packages/core/src/images/png.ts` (459). One split per run.
3. R5 — comment lines in 432 of the first 2000 non-test package source files; too broad to fix
   wholesale, pick per-file alongside R1 splits.

## Ruled out

- R1 for `packages/db/migrations/**` (generated/self-emitted migrations), `packages/db/.agents/skills/**`
  (vendored Prisma skill), `*.generated.ts`, `apps/*/prototype/**`, `**/spikes/**`, `apps/*/scripts/**`
  bench/probe scripts: generated, vendored or throwaway.
- R7 for `src/api/hydrate-env.ts`, `src/api/validate-environment.ts`, `src/trigger/tier-env.ts`,
  `src/trigger/github/github-sweep-graph.ts`: bootstrap code that runs before `EnvService` exists, the
  same reason `main.ts` is sanctioned. Proposed: list them in `apps/api/AGENTS.md`.

## Runs

### 2026-11-19

- Built the rule list (R1–R10) from all 12 instruction files. R3, R4, R6, R8, R9, R10 clean.
- Fixed R2: the only `as any` in the repo, `apps/tui/scripts/proto-shimmer.tsx:260`, now builds a typed
  `ToolCall` (its literal was a stale shape with `settled`/`failed` fields). Proved the type check bites
  by setting `state: 'ok'` (TS2322), then restored.
