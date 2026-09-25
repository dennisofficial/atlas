# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

## What this repo is

Atlas is a **coding-agent harness**. Not a wrapper around someone else's harness — the agentic
loop is ours. We make raw LLM calls through the Vercel AI SDK and own every decision the loop
makes: what context the model sees, which tools it may call, when a human is asked, what happens
on rewind.

Because we make raw model calls, Atlas is model-agnostic by construction. Claude and Codex
subscription credentials are one provider implementation among several, not a foundation.

## Who uses Atlas

**A small team, in a public repo.** Atlas is built by the people who run it every day — there is
no separate customer base, no support burden, and no migration window. Weigh decisions
accordingly: a breaking change costs an afternoon, not a quarter, and a feature nobody has asked
for is a feature nobody needs. But the code is read by contributors and strangers now, so keep
interfaces honest and note setup-breaking changes in the PR. Spend the saved effort on the things
daily users still feel: a hang, a silent failure, a seam that makes the next feature cheap.

Contributions are welcome — `CONTRIBUTING.md` holds the setup and the PR flow.

Read `docs/architecture.md` before changing anything structural. It is the source of truth over
any inference from code, and `docs/core-contract.md` holds the seams it depends on.
`docs/research/` holds the primary-source investigation both were derived from.

## Package layout

| Package                      | Depends on     | Owns                                                          |
| ---------------------------- | -------------- | ------------------------------------------------------------- |
| `@dltech/atlas-core`         | `zod` only     | Events, IDs, context assembly, hook and port contracts. Pure.  |
| `@dltech/atlas-harness`      | core           | The loop, hooks, tools, model adapters, credentials, store.    |
| `@dltech/atlas-ui`           | nothing        | Design tokens and web UI atoms; Storybook. No Atlas imports.   |
| `@dltech/atlas-wire`         | `zod` only     | The wire contract: channel/session zod schemas, protocol version, serve-env constants. No in-repo deps. |
| `@dltech/atlas` (`apps/tui`) | core, harness  | OpenTUI + React terminal app; binds its stores into the shared root. |
| `@dltech/atlas-api` (`apps/api`) | `@dltech/atlas-wire` only | Atlas Cloud backend (NestJS + better-auth + Prisma/Neon). |
| `web` (`apps/web`) | nothing in-repo | Atlas Cloud frontend (Next.js App Router; deploys to Vercel). |

A package boundary is worth it only where the compiler should enforce a dependency rule.

**`ui` is a design-system package, not an Atlas app package.** Its token layer (`/tokens`) is
pure TS with no platform imports — that subpath is the contract a future Expo app consumes. Its
atoms are honest web components (Radix + CVA + Tailwind v4); nothing in the package imports from
`core` or `harness`.

**`core` performs no I/O.** No filesystem, no network, no database, no clock, no randomness. It is
pure functions and types. When something is hard to test, that is the signal to move the decision
into `core`, not to add a mock.

**`tui` never reaches past `harness`.** It talks to `harness` through its ports. The shared
composition root lives in `packages/harness/src/composition` (`composeHarness`); `apps/tui`
supplies only its surface bindings (notices, tl;dr feed) through it. Plugins are loaded by the
shared root itself (`packages/harness/src/plugins`), so serve sessions get the same hooks, tools,
and prompt fragments; only the UI contributions (projections, surfaces) are TUI-concrete.

**Features live in `harness`; surfaces own none.** The TUI, serve, and (later) web are interfaces
to the same harness over different transports — nothing more. The harness is location-agnostic: a
session behaves identically whether its loop runs on the local machine or in a cloud container, and
two sessions of different kinds must think identically, not just act identically — same hooks, same
tools, same prompt fragments. The TUI is *only* a UI — no ad-hoc behavior, no feature logic of its
own. Anything a session does — classifiers, guardrails, decision models, tools — is harness-level
machinery the shared root composes into every session kind, configured per session; if it cannot be
composed into every session kind, it does not belong in a session at all. Surface-specific behavior
should be rare and deliberate — transport-latency loading states are the exemplar — never a quiet
feature fork. When a surface needs something the harness does not offer, the surface gets an adapter
or a port, not a reimplementation. `apps/tui` contributes projections and surfaces; `apps/api`
provisions and configures sessions. Neither reimplements what the loop owns.

**`api` runs on Node, not Bun, and tests with vitest, not `bun test`.** Nest's dependency
injection needs legacy decorators with emitted metadata, which Bun's transpiler silently drops —
this is the same constraint that bars tsyringe decorators elsewhere in the repo, answered the
other way. `apps/api/AGENTS.md` holds its conventions (env tiers, module layout, testing tiers).

## `deprecated/`

`deprecated/` holds frozen reference code and is **not a Bun workspace member**:

| Path                      | What it was                                                            |
| ------------------------- | ---------------------------------------------------------------------- |
| `deprecated/tui`          | The previous Atlas TUI, built over the Claude and Codex agent SDKs.    |
| `deprecated/agent-engine` | `@workspace/agent-engine` — never-run EngineAdapter port. Prior art.   |
| `deprecated/codex-sdk`    | `@workspace/codex-sdk` — JSON-RPC client for the `codex app-server`.   |
| `deprecated/backend`      | Paused NestJS cloud harness.                                           |
| `deprecated/web`          | Paused Next.js front end for the cloud harness.                        |
| `deprecated/shared`       | `@workspace/shared` — DTOs and enums for backend + web.                |
| `deprecated/docs`         | The design docs for the above: wireframes, architecture, decisions.    |
| `deprecated/.github`      | The CI and blue/green deploy workflows for the cloud stack.            |
| `deprecated/infra`        | Dockerfiles, Caddy, deploy scripts, prod compose.                      |

Read it for prior art. Never import from it, never extend it, and do not fix it. It does not
install and is not expected to build.

## Code style

- **Max 300 lines per file.** Split into focused modules if exceeded.
- **No `as any` casts.** Use proper types, generics, or `unknown` with type guards.
- **No `@ts-ignore` / `@ts-expect-error`.** Fix the type instead.
- **Strict TypeScript.** `strict`, `noUncheckedIndexedAccess`, no implicit `any`.
- **Early returns** over nested conditionals.
- **Named parameters** for functions with 2+ arguments.
- **Event handlers** prefixed with `handle`.
- **`E`-prefixed real TS enums** for value unions (`EEngine`, `EHookPhase`), not const-tuple + type.

## Comments

**Don't write them.** A comment is a second thing to maintain that the compiler cannot check, and
it silently rots the moment the code beneath it changes. Two artifacts, one truth, no enforcement.

Make the code say it instead:

- Rename the variable, function, or type until the line explains itself.
- Extract a well-named function rather than heading a block with a comment.
- Encode the constraint in the type system, where it is checked.
- Put the scenario in a test, where it is executed.

The one exception is a fact that **lives outside this repository** and therefore cannot drift when
the code is refactored: a provider's undocumented protocol quirk, a spec section number, a
deliberate deviation from a library's intended use and the bug that forced it. Those are durable,
so they are worth writing down. Link the source when there is one.

Never write a comment that restates the code, labels a section, marks a step number, or explains a
language feature. Delete those on sight when you encounter them.

No JSDoc on internal code. Exported API of a package may carry a one-line description where the
name genuinely cannot carry it alone.

This rule is inverted from what `deprecated/` does. Do not carry that density forward.

## Dependency injection

**Bun cannot run tsyringe's decorators.** Bun's transpiler rewrites legacy decorators as TC39
standard decorators and silently drops constructor-parameter decorators, so `@inject(...)` and
`@injectAll(...)` never execute under Bun no matter what `experimentalDecorators` or
`emitDecoratorMetadata` says. tsyringe's `TypeInfo not known for "X"` is the symptom that
reaches tests.

Therefore classes never carry tsyringe decorators — the registrar decides construction:

- Zero-argument constructor → `container.register(token, { useClass: X })`.
- Any constructor parameters → `container.register(token, { useFactory: (resolver) =>
  new X(resolver.resolve(dep)) })`.
- One instance per container → wrap the factory in `instanceCachingFactory`.

Spec-side wiring follows the same rule: construct with `new X(...)` rather than resolving a class
token out of a container. Tokens resolve ports and symbol keys; class tokens are for zero-arg
classes only.

## Testing

- **Every new feature includes tests.** TDD preferred.
- Tests live in a sibling `__tests__/` directory as `*.spec.ts(x)`.
- `bun test` everywhere.
- Live Docker specs (anything gating on `describeLiveDocker` / `dockerUnavailableReason`, plus the
  docker shell-adapter specs) run only with `ATLAS_LIVE_DOCKER=1`; CI sets it. Locally they skip by
  default so a running Docker Desktop doesn't turn every `bun test` pass into real containers.
- Context assembly, hook resolution, and policy decisions are pure and belong to `core` — test them
  with plain data, never with a live model, a terminal, or a database.

## TUI performance

OpenTUI repaints **every visible renderable every frame** — there is no dirty-region painting — so
the renderable count of the visible tree is the per-frame cost, and the frame count is the rest.
These are measured facts from the September 2026 perf round (#338, #340, #342, #343, #346); the
throwaway probe that produced the numbers is `apps/tui/scripts/proto-shimmer.tsx`.

- **One `<text>` with styled spans, never a `<box>` + `<text>` per cell.** A row of N elements costs
  N × (5 native handles + a Yoga node) and is repainted every frame; one text with spans draws the
  same pixels for a fraction of it. Gutter numbers, signs, background tints: they are all spans.
- **A React commit is a frame.** Never `setState` on a timer in a component — subscribe to the
  shared ticker (`subscribeTicker` in `ui/hooks/use-shimmer-clock.ts`) and write to the renderable
  by ref (`content`, or a span's `children`), so the tick skips React entirely.
- **An effect that awaits and then `setState`s must be keyed on content and bail when the answer is
  unchanged.** Keyed on array identity, it loops render → effect → setState forever at 60 fps — one
  such block pinned a whole core per tile. See `tool-block-idle.spec.tsx`.
- **Never `content={new StyledText(...)}` inline.** `content` compares by reference, so a fresh
  object is a full native buffer re-push every render. Memoize it.
- **`targetFps` is inert.** The renderer is request-driven; frames happen only when something calls
  `requestRender` (every React commit does), capped by `maxFps` (60). When a tile is hot while idle,
  count frames first (`renderer.getStats().frameCount` over a quiet window) — nonzero means a state
  loop, and the fix is upstream of any cadence knob.

## Git

- **Branch from `origin/main`, ship as a PR.** Branch as `<you>/<slug>` (e.g.
  `dennis/add-the-thing`), push, `gh pr create`, and merge with `gh pr merge --squash` once CI is
  green. Keep PRs small enough to review in one sitting.
- **Daily driving is the prod `atlas` binary; `atlas-dev` is for developing.** The binary
  updates itself from GitHub releases, which are cut on every release-worthy merge to main.
  `atlas-dev` runs from source and takes `--worktree <slug>` to run a worktree's code instead of
  the main checkout's. The main checkout stays read-only: `atlas-dev` flags every running
  terminal as stale the moment the tree moves, so direct edits there turn that notice into
  noise. Cut a worktree under `.atlas/worktrees/<slug>`, do the work there, and after the merge
  remove the worktree, delete the local branch, and `git pull --ff-only` in the main checkout.
  Merge from inside a worktree with plain `gh pr merge --squash`, never `--delete-branch`, which
  fails on the local `main` checkout after the merge has already landed.
- Never force-push, never `--no-verify`.
- **Never use `git stash`** unless explicitly asked.
- Conventional commits: `<type>(<scope>): <description>` — imperative, lowercase. The merged PR
  title is the release decision: `feat` cuts a minor, `fix` a patch, anything else no release.
  Reserve `feat` for "a user can do something today they couldn't yesterday" — cosmetic tweaks,
  restyles, and behavior polish are `fix` or `refactor`.
- No `Co-Authored-By` or "Generated with Claude" trailers.

## Workspace mechanics

**Bun is both the package manager and the runtime.** `bun install` from the repo root installs the
whole workspace; `bun.lock` is committed. Workspace members are declared in the root
`package.json` → `workspaces` (`packages/*`, `apps/*`). Never `pnpm install` / `npm install` /
`yarn`. `.nvmrc` still pins Node 22.13, for the node-based CLIs in root `devDependencies`.

The runtime was already Bun and still is, for the reasons it always was: OpenTUI's renderer is a
Zig library reachable only through Bun's FFI, and `bun build --compile` produces the shipped
binary. The package manager has simply stopped being a second tool.

- `typescript`, `react`, `react-dom`, and their `@types` are pinned repo-wide via root
  `package.json` → `overrides`; don't bump them in one package. Those pins are the only thing
  keeping a single instance of each — Bun's isolated linker does not dedupe across versions.
- `bunfig.toml` pins the **isolated** linker: real packages live in `node_modules/.bun/` and each
  member's `node_modules` holds symlinks to exactly its declared dependencies, so a package you did
  not declare will not resolve. Bun 1.3 already defaults to this for workspaces; the file makes it
  a decision rather than a default we inherited.
- Lifecycle scripts run only for packages on Bun's default allowlist. Nothing in the live workspace
  currently needs more; if `bun pm untrusted` ever reports a blocked postinstall, add that package
  to root `package.json` → `trustedDependencies` and say why.

**Turborepo runs the tasks.** `bun run typecheck` / `test` / `build` at the root are
`turbo run <task>`; `turbo.json` holds the graph. Per-package scripts still call `tsc` and
`bun test` directly — turbo orchestrates, it is not the runner.

- Run one package with `turbo run <task> --filter @dltech/atlas-core`, or `bun run <script>` inside
  the package.
- `typecheck` and `test` declare `outputs: []` — they produce no artifacts, only an exit code.
- Every task declares `dependsOn: ["^<task>"]`. That is load-bearing, not ordering garnish: the
  packages are raw TS with no build step, so a change in `core` must invalidate `tui`'s cached
  typecheck, and the topological edge is what makes it do so.
- `tsconfig.base.json` is in `globalDependencies`; editing it busts every cache entry.

**CI must actually build the binary**, not merely typecheck. Bundling a Bun binary surfaces failures a
typecheck cannot: runtime assets loaded by path, and optional peer dependencies that need `--external`.
Nest was the original reason for that warning and now lives only under `deprecated/`, but the class of
failure is not specific to it — the tree-sitter grammars are the live example.

## Sandbox image

The sandbox image is a private GHCR listing; access rides on GitHub.

## Agent skills

### Issue tracker

GitHub Issues is the ticket tracker — not Jira, not Linear. Tickets live on this repo as issues,
triaged with the labels below; a GitHub Projects board carries them across states. The repo is
public, so the tracker is too — contributors see the same queue we do.

Specs stay local markdown under `.scratch/<feature-slug>/`, which is gitignored: one directory per
effort, a `spec.md` plus working notes. A spec is the private working document for an effort; the
issue is the public ticket. Delete the spec once the work ships — the code is the documentation.

When a PR resolves an open issue, reference it in the PR body with a closing keyword
(`Closes #N`, `Fixes #N`) so the merge closes the ticket. When work ships with no issue, that is
fine — but when one exists, link it.

### Triage labels

The repo's labels are the GitHub defaults — `bug`, `documentation`, `duplicate`, `enhancement`,
`good first issue`, `help wanted`, `invalid`, `question`, `wontfix` — plus two of ours:
`needs-triage`, applied to anything not yet triaged onto the workstream board, and
`atlas-factory`, for work the factory files or picks up. (`autorelease: pending` belongs to the
release automation, not triage.) There is no `ready-for-agent` or `ready-for-human`: readiness
for an agent is read off the Projects board, not off a label.
