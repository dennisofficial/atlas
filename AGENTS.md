# AGENTS.md

Atlas is a model-agnostic coding-agent harness. The agent loop is ours: raw LLM calls through the
Vercel AI SDK. We decide what context the model sees. We decide which tools it can call. We decide
when the operator is asked. We decide what happens on rewind. The Claude and Codex credentials are
one provider among several.

Atlas has one operator, who also builds it. The repository is public and has occasional
contributors (`CONTRIBUTING.md`). There is no customer data or workflow to preserve, so a breaking
change costs an afternoon. Do not build a feature nobody asked for. Keep interfaces honest for
readers. Note a setup-breaking change in the PR. Spend the effort on what the operator feels:
hangs, silent failures, seams that make the next feature cheap.

Read `docs/architecture.md` before you change anything structural. It and `docs/core-contract.md`
win over an inference from code. The v2 redesign (client ↔ control plane ↔ pod) lives in `docs/v2`.
A package or app can carry its own `AGENTS.md` with local rules.

## Boundaries

The repository is a Bun workspace of `packages/*` and `apps/*`. A package boundary exists only
where the compiler should enforce a dependency rule.
- **`core` is pure** (`zod` only): it has no filesystem, network, database, clock or randomness.
  When something is hard to test, move the decision into `core`. Do not add a mock.
- **Features live in `harness`; surfaces own none.** TUI, serve, web and the API are interfaces to
  one harness over different transports. Every session kind must think identically: the same
  hooks, tools and prompt fragments, composed by `composeHarness`
  (`packages/harness/src/composition`), which also loads plugins. A surface that lacks something
  gets a port or adapter. It never gets a reimplementation. Surface-specific behavior, such as
  transport-latency loading states, is rare and deliberate.
- **A session feature is done when its port is registered.** Feature logic runs on a runtime port
  implementation. It reaches detached clients through a transport adapter. A port with no remote
  surface declares an explicit empty transport slot. Ports are registered in
  `packages/core/src/ports/registry.ts` (extended by harness). `composeHarness` requires the full
  manifest, so a missing binding breaks typecheck.
- **`tui` never reaches past `harness`.**
- **`ui` is a design system with no Atlas imports**: shadcn `base-nova` (Base UI + CVA + Tailwind
  v4) plus AI Elements. Its `/tokens` subpath is pure TS and imports no platform module.
- **Clients reach the API through `@dltech/atlas-api-router`** (the generated `AppRouter` and
  `createApiClient`). They never import `apps/api`.
- **`deprecated/` is frozen prior art** outside the workspace. Read it. Never import, extend or fix
  it. Do not copy its comment density.

## Code style

- Keep each file to 300 lines at most. Split a large file into focused modules.
- Use strict TypeScript (`strict`, `noUncheckedIndexedAccess`). Do not use `as any`, `@ts-ignore`
  or `@ts-expect-error`. Fix the type.
- Match the house form:
  - Return early.
  - Use named parameters for 2 or more arguments.
  - Prefix each event handler with `handle`.
  - Use a real `E`-prefixed enum (`EEngine`) for a value union.
- **No comments.** Express the meaning in names, extracted functions, types and tests. One
  exception is a fact that lives outside the repository and cannot drift with a refactor: a
  provider's undocumented quirk, a spec section, a deliberate library misuse and the bug that
  forced it (link the source). Do not write JSDoc on internal code. An exported API can carry one
  line where its name cannot.
- **No tsyringe decorators**: Bun drops constructor-parameter decorators. Register a zero-argument
  class with `useClass`. Register everything else with `useFactory: (r) => new X(r.resolve(dep))`,
  wrapped in `instanceCachingFactory` for one per container. Construct with `new X(...)` in specs.
  Nest's `@Inject` does work in `apps/api`; see its `AGENTS.md`.

## Testing

- Every feature ships with tests. TDD is preferred. A spec is `*.spec.ts(x)` in a sibling
  `__tests__/`.
- Run `bun test` everywhere, and import from `bun:test`. Run it inside the package, because Bun
  reads that package's `bunfig.toml` preloads. `bun run test` at the root fans out. Only `evals/`
  stays on Vitest (`bun --bun vitest run`).
- Tests are incremental (`packages/bun-test-incremental`). With `BUN_TEST_INCREMENTAL=1` (always
  on in CI) only a spec whose inputs changed runs. A failure is never cached. Never add path
  filters or sharding to CI. The nightly runs everything.
- Live Docker specs run only with `ATLAS_LIVE_DOCKER=1`, which CI does not set (several need
  repair).
- A v2 feature whose work outlives a turn or a prepare (a background setup script, a bash call)
  ships a `describeHandoff` scenario in `apps/api/src/agent/__tests__/faults/`. The scenario must
  survive a host draining, a host being SIGKILLed and a pod restart. It must run exactly once.
- Context assembly, hook resolution and policy decisions are pure `core` code. Test them with plain
  data. Never use a live model, terminal or database.

## Git and releases

- Branch `<you>/<slug>` from `origin/main`. Open a PR. Run `gh pr merge --squash` when CI is green.
  Keep each PR reviewable in one sitting. Never force-push. Never use `--no-verify`.
- The PR body follows `.github/pull_request_template.md`. `gh pr create --body` skips the template,
  so copy it. Fill in every section. Keep every checklist line, and tick it or mark it N/A as the
  template says. Pass the body with `--body-file`.
- Write conventional commits, imperative and lowercase: `<type>(<scope>): <description>`. The PR
  title sizes the release: `feat` cuts a minor, and anything else a patch. Reserve `feat` for
  something an operator can do today that they could not do yesterday. Polish and a restyle are
  `fix` or `refactor`.
- A merge releases when its title is `fix` or `feat`, or when it changes TUI, serve, Mac or web,
  directly or through a dependency. The API deploys on every merge. A sandbox downloads the latest
  serve _release_ instead, so an API change that the released serve or TUI cannot talk to must be
  titled `fix` or `feat` to cut a release (#1400 left every new sandbox hanging on "Start Atlas").

## Workspace

- Bun is the package manager and the runtime. OpenTUI needs Bun's FFI, and `bun build --compile`
  makes the binary. Run `bun install` at the root. Never use npm, pnpm or yarn.
- Biome formats and lints (`biome.json`); there is no Prettier. Format only the files you touched,
  with `bunx biome check --write <files>`. Never use `prettier`. Never format the whole project
  directory.
- The isolated linker means an undeclared dependency will not resolve. `typescript`, `react`,
  `react-dom` and their types are pinned in the root `overrides`. Never bump them in one package.
  A blocked postinstall goes in the root `trustedDependencies` with the reason.
- Turborepo orchestrates `bun run typecheck|test|build`. One package is
  `turbo run <task> --filter <name>`. Packages are raw TS with no build step, so every task keeps
  `dependsOn: ["^<task>"]` to invalidate a dependent. CI runs tests with `bun test`, not turbo.
- CI builds the real binaries, not only a typecheck. Bundling catches an asset loaded by path (the
  tree-sitter grammars) and an optional peer that needs `--external`.
- The sandbox image publishes to GHCR (`ghcr.io/<owner>/atlas-sandbox`, multi-arch, `sha-<7>` and
  `latest`, anonymous pulls) and to Vercel's VCR (`linux/amd64`, `latest` only). Serve is not in
  the image. A sandbox downloads the release that matches its client at boot.

## Environment secrets

- Manage secrets with `dotenvx`. The committed, encrypted tier files at each app's root
  (`apps/<app>/.env.<tier>.enc`, e.g. `apps/api/.env.production.enc`) are the source of truth for
  every tier, local dev included.
- A deploy target (Vercel, trigger.dev, Render, GitHub Actions) holds only the private key. dotenvx
  reads exactly the name that matches the `DOTENV_PUBLIC_KEY_*` line at the top of the file
  (`DOTENV_PRIVATE_KEY_PRODUCTION_ENC` for `.env.production.enc`). A renamed tier file therefore
  renames the key everywhere. Never paste an app secret into a vendor dashboard.
- A private key lives in a gitignored `.env.keys` beside the `.enc` file, where dotenvx finds it on
  its own. In Atlas Cloud the key is a project file mount, so add or rotate it there. Per-machine
  plaintext goes in a gitignored `.env.personal`. It loads after the tier and cannot override a key
  that the tier already sets.
- Encrypting needs no private key, because the public key is in the file. Decrypting needs one.
  Encrypting a file that has no public key yet mints a new keypair.
- The CLI is a root devDependency and is not on `PATH`. Run it as `bunx dotenvx`.
  - `dotenvx get KEY -f <file>` reads one value. `dotenvx get -pp -f <file>` prints all of them as
    JSON. Without the private key `get` prints the ciphertext and exits 0. Add `--strict` to fail.
  - `dotenvx set KEY VALUE -f <file>` writes the value encrypted.
  - `dotenvx decrypt -f <file> --stdout` prints the plaintext file. Without `--stdout`, `decrypt`
    and `encrypt` rewrite the file in place. Re-encrypt before you commit, or the pre-commit hook
    (`dotenvx ext precommit`) rejects it.
  - `dotenvx run -f <file> -- <cmd>` injects the values into a process. `apps/api` wraps this as
    `bun run env:inject -- <cmd>`.

## Triage

Use GitHub's default labels, plus `needs-triage` for anything not yet on the workstream board. Read
agent readiness off the Projects board, not off a label.
