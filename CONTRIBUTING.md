# Contributing to Atlas

Atlas is a coding-agent harness — the agentic loop is ours, built on raw model calls through the
Vercel AI SDK. It is developed in the open by the small team that runs it every day, and
contributions are welcome.

## Setup

- **Bun 1.3+** is both the package manager and the runtime. Never `npm` / `pnpm` / `yarn`.
- `bun install` from the repo root installs the whole workspace.

## The dev loop

All root scripts are turbo tasks:

- `bun run typecheck` — `tsc --noEmit` across the workspace.
- `bun run test` — the full `bun test` suite. Point `ATLAS_HOME` at a scratch directory and keep
  `NODE_ENV=development`:
  `ATLAS_HOME=$PWD/.atlas-home NODE_ENV=development bun run test`.
- `bun run build` — compiles the `atlas` binary. Run this before opening a PR: bundling surfaces
  failures a typecheck cannot (runtime assets loaded by path, optional peers needing
  `--external`).
- `apps/tui/bin/atlas-dev` runs the TUI from source. `--worktree <slug>` runs a worktree's
  source instead: `atlas-dev --worktree my-branch` execs
  `.atlas/worktrees/my-branch/apps/tui/bin/atlas-dev`.

## Daily driving

Run the prod binary, not source. It self-updates from GitHub releases on `/restart`. Install:

```
gh api repos/dennisofficial/atlas/contents/install.sh --jq .content | base64 -d | bash
```

`install.sh` detects your platform, verifies the sha256, and installs to `~/.local/bin/atlas`
(override with `ATLAS_INSTALL_DIR`).

Run one package with `turbo run <task> --filter @dltech/atlas-core`, or `bun run <script>` inside
the package.

## Making a change

1. Branch from `origin/main` as `<you>/<slug>`.
2. Every new feature includes tests — `bun test`, specs in a sibling `__tests__/` directory.
3. Conventional commits: `<type>(<scope>): <description>`, imperative, lowercase. No
   `Co-Authored-By` or generated-with trailers.
4. Open a PR. CI runs typecheck, the test suite, and a real binary build; all must be green.
   Keep PRs small enough to review in one sitting.

## The rules that bite

- Max 300 lines per file. No `as any`. No `@ts-ignore`. Strict TypeScript.
- Don't write comments — rename, extract, or encode the constraint in the type system instead.
  The exception is a fact that lives outside this repository.
- `deprecated/` is frozen reference code: read it for prior art, never import from it, never fix
  it.

`CLAUDE.md` is the full contributor contract — package layout, dependency-injection rules, testing
philosophy, and TUI performance guidance. Read `docs/architecture.md` before changing anything
structural.
