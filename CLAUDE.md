# CLAUDE.md

Atlas is a model-agnostic coding-agent harness. The agent loop is ours: raw LLM calls through the
Vercel AI SDK, and we decide what context the model sees, which tools it may call, when a human is
asked and what happens on rewind. Claude and Codex credentials are one provider among several.

It has one user, the developer building it, in a public repo with occasional contributors
(`CONTRIBUTING.md`). There is no customer data or workflow to preserve: a breaking change costs an
afternoon, and a feature nobody asked for is not needed. Keep interfaces honest for readers, note
setup-breaking changes in the PR, and spend the effort on what the user feels: hangs, silent
failures, seams that make the next feature cheap.

Read `docs/architecture.md` before changing anything structural; it and `docs/core-contract.md` win
over inferences from code. The v2 redesign (client ↔ control plane ↔ pod) lives in `docs/v2`.
Packages and apps may carry their own `AGENTS.md` with local rules.

## Boundaries

A Bun workspace of `packages/*` and `apps/*`. A package boundary exists only where the compiler
should enforce a dependency rule.
- **`core` is pure** (`zod` only): no filesystem, network, database, clock or randomness. When
  something is hard to test, move the decision into `core` instead of adding a mock.
- **Features live in `harness`; surfaces own none.** TUI, serve, web and the API are interfaces to
  one harness over different transports, and every session kind must think identically: same hooks,
  tools and prompt fragments, composed by `composeHarness` (`packages/harness/src/composition`),
  which also loads plugins. A surface that lacks something gets a port or adapter, never a
  reimplementation; surface-specific behavior (transport-latency loading states) is rare and
  deliberate.
- **A session feature is done when its port is registered.** Feature logic runs on a runtime port
  implementation and reaches detached clients through a transport adapter; a port with no remote
  surface declares an explicit empty transport slot. Ports are registered in
  `packages/core/src/ports/registry.ts` (extended by harness), and `composeHarness` requires the
  full manifest, so a missing binding breaks typecheck.
- **`tui` never reaches past `harness`.**
- **`ui` is a design system with no Atlas imports**: shadcn `base-nova` (Base UI + CVA + Tailwind
  v4) plus AI Elements. Its `/tokens` subpath is pure TS with no platform imports.
- **Clients reach the API through `@dltech/atlas-api-router`** (the generated `AppRouter` and
  `createApiClient`), never by importing `apps/api`.
- **`deprecated/` is frozen prior art** outside the workspace: read it, never import, extend or fix
  it, and don't copy its comment density.

## Code style

- Max 300 lines per file; split into focused modules.
- Strict TypeScript (`strict`, `noUncheckedIndexedAccess`). No `as any`, `@ts-ignore` or
  `@ts-expect-error`: fix the type.
- Early returns, named parameters for 2+ arguments, `handle`-prefixed event handlers, and real
  `E`-prefixed enums (`EEngine`) for value unions.
- **No comments.** Say it with names, extracted functions, types and tests. The exception is a fact
  that lives outside the repo and cannot drift with a refactor: a provider's undocumented quirk, a
  spec section, a deliberate library misuse and the bug that forced it (link the source). No JSDoc
  on internal code; an exported API may carry one line where its name cannot.
- **No tsyringe decorators**: Bun drops constructor-parameter decorators. Register zero-argument
  classes with `useClass`, everything else with `useFactory: (r) => new X(r.resolve(dep))` (wrapped
  in `instanceCachingFactory` for one per container), and construct with `new X(...)` in specs.
  Nest's `@Inject` in `apps/api` does work; see its `AGENTS.md`.

## Testing

- Every feature ships with tests, TDD preferred. Specs are `*.spec.ts(x)` in a sibling `__tests__/`.
- `bun test` everywhere, importing from `bun:test`. Run it inside the package, since Bun reads that
  package's `bunfig.toml` preloads; `bun run test` at the root fans out. Only `evals/` stays on
  Vitest (`bun --bun vitest run`).
- Tests are incremental (`packages/bun-test-incremental`): with `BUN_TEST_INCREMENTAL=1` (always on
  in CI) only specs whose inputs changed run, and failures are never cached. Never add path filters
  or sharding to CI; the nightly runs everything.
- Live Docker specs run only with `ATLAS_LIVE_DOCKER=1`, which CI doesn't set (several need repair).
- Context assembly, hook resolution and policy decisions are pure `core` code: test them with plain
  data, never a live model, terminal or database.

## Git and releases

- Branch `<you>/<slug>` from `origin/main`, open a PR, and `gh pr merge --squash` once CI is green.
  Keep PRs reviewable in one sitting. Never force-push or `--no-verify`.
- Conventional commits, imperative and lowercase: `<type>(<scope>): <description>`. The PR title
  sizes the release: `feat` cuts a minor, anything else a patch. Reserve `feat` for something a
  user can do today that they couldn't yesterday; polish and restyles are `fix` or `refactor`.
- A merge releases when it is a `fix`/`feat` or changes TUI, serve, Mac or web (directly or through
  a dependency). The API deploys on every merge, but sandboxes download the latest serve _release_,
  so an API change the released serve or TUI can't talk to must be titled `fix` or `feat` to cut
  one (#1400 left every new sandbox hanging on "Start Atlas").

## Workspace

- Bun is the package manager and the runtime (OpenTUI needs Bun's FFI; `bun build --compile` makes
  the binary). `bun install` at the root; never npm, pnpm or yarn.
- The isolated linker means an undeclared dependency won't resolve. `typescript`, `react`,
  `react-dom` and their types are pinned in root `overrides`; never bump them in one package. A
  blocked postinstall goes in root `trustedDependencies` with the reason.
- Turborepo orchestrates `bun run typecheck|test|build`; one package is
  `turbo run <task> --filter <name>`. Packages are raw TS with no build step, so every task keeps
  `dependsOn: ["^<task>"]` to invalidate dependents. CI runs tests with `bun test`, not turbo.
- CI builds the real binaries, not just a typecheck: bundling catches assets loaded by path (the
  tree-sitter grammars) and optional peers that need `--external`.
- The sandbox image publishes to GHCR (`ghcr.io/<owner>/atlas-sandbox`, multi-arch, `sha-<7>` and
  `latest`, anonymous pulls) and Vercel's VCR (`linux/amd64`, `latest` only). Serve isn't in the
  image; a sandbox downloads the release matching its client at boot.

## Environment secrets

- Secrets are managed with `dotenvx`. The committed, encrypted `*.enc` files (e.g.
  `apps/api/envs/.env.api.<tier>.enc`) are the source of truth for every tier, local dev included.
- Deploy targets (Vercel, trigger.dev, Render, GitHub Actions) hold only the private key. Its name
  matches the `DOTENV_PUBLIC_KEY_*` line at the top of the file, e.g.
  `DOTENV_PRIVATE_KEY_API_PRODUCTION`. Never paste an app secret into a vendor dashboard.
- Private keys live in a gitignored `.env.keys` beside the `.enc` file, where dotenvx finds them on
  its own. In Atlas Cloud they are project file mounts, so add or rotate a key there. Per-machine
  plaintext goes in a gitignored `.env.personal`; it loads after the tier and can't override a key
  the tier already sets.
- Encrypting needs no private key (the public key is in the file); decrypting does. Encrypting a
  file that has no public key yet mints a new keypair.
- The CLI is a root devDependency, not on `PATH`: run it as `bunx dotenvx`.
  - `dotenvx get KEY -f <file>` reads one value; `dotenvx get -pp -f <file>` prints all of them as
    JSON. Without the private key `get` prints the ciphertext and exits 0; add `--strict` to fail.
  - `dotenvx set KEY VALUE -f <file>` writes the value encrypted.
  - `dotenvx decrypt -f <file> --stdout` prints the plaintext file. Without `--stdout`, `decrypt`
    and `encrypt` rewrite the file in place; re-encrypt before committing, or the pre-commit hook
    (`dotenvx ext precommit`) rejects it.
  - `dotenvx run -f <file> -- <cmd>` injects the values into a process; `apps/api` wraps this as
    `bun run env:inject -- <cmd>`.

## Triage

GitHub's default labels plus `needs-triage` for anything not yet on the workstream board. Agent
readiness is read off the Projects board, not a label.
