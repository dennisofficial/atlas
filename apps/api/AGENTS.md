# apps/api

The Atlas Cloud backend. NestJS 11 + better-auth + Prisma 7 (driver adapter) over PostgreSQL
(Neon in deployed tiers, docker locally). First client is the Atlas TUI; the first job is
credential centralization (see `.scratch/atlas-cloud/spec.md` while the effort is in flight).

## Runtime and tests — the exception

This package runs on **Node**, not Bun, and tests with **vitest**, not `bun test`. Nest's DI
requires legacy decorators with emitted metadata; Bun's transpiler drops them. vitest needs
`unplugin-swc` with `legacyDecorator` + `decoratorMetadata` for the same reason (see
`vitest.config.mts`). Everything else in the repo runs on Bun — keep this exception scoped to
this package.

## Layout

```
src/
  _core/      kernel: env module, decorators, ports, types. Imports nothing from slices.
  _lib/       infra adapters (crypto). Framework-light.
  _module/    shared injectable modules (session guard + verifier port).
  api/        the deployable app: main.ts, app.module.ts, feature modules (auth, health).
prisma/       schema, migrations, lazy `db` client proxy (import via the `@db` alias).
envs/         dotenvx tier files (.env.api.<tier>.enc, committed; .env.keys, never).
test/         cross-cutting specs (env alignment).
```

Path aliases (`@core/*`, `@lib/*`, `@module/*`, `@api/*`, `@db`) are declared in
`tsconfig.json`, mirrored in `vitest.config.mts`, and rewritten for the build by `tsc-alias`.
`@db` maps to the `prisma/` directory, not a file — tsc-alias keeps a `.ts` extension on
file-target aliases, which Node cannot load.

## Auth

better-auth is mounted through `@thallesp/nestjs-better-auth` in `src/api/auth/auth.module.ts`,
with `organization`, `bearer`, and `deviceAuthorization` plugins. Guards never import
better-auth: they depend on the `SESSION_VERIFIER` port (`src/_core/ports/session-verifier.ts`),
bound by `SessionModule.withVerifier(...)`. Feature routes opt into protection with
`@UseGuards(SessionAuthGuard)` and opt out with `@Public()`.

The device-authorization flow is how the TUI logs in. Until a web app exists, the API serves
minimal `/sign-up`, `/sign-in`, and `/device` pages itself; the device page must claim the code
(`GET /api/auth/device?user_code=…`) while signed in before approve/deny will work.

## Env

House dotenvx conventions (see the `env-conventions` skill): encrypted per-tier files in
`envs/`, `.env.keys` and `.env.personal` git-ignored, key parity across tiers enforced by
`test/env-alignment.spec.ts`. Add a variable in lockstep: the right `sections/*.ts` Joi rule +
interface field, then the key line in every tier file (commented with a recognized reason where
a tier does not supply it), then `dotenvx set` to fill values in place. Typed access is
`env.get('KEY')` via `EnvService`; never read `process.env` in app code (sanctioned exceptions:
`main.ts` bootstrap and `auth.server.ts`, which construct before Nest DI exists).

Local boot: `bun run db:up` (docker Postgres on 5433), `bun run db:migrate`, `bun run dev`.
Migrations run through `db:migrate` (dotenvx-injected); in deployed tiers they run via
`db:migrate:deploy` with `MIGRATE_TIER` set, never from the app container.

## Rules that differ from the rest of the repo

- vitest unit specs are colocated `*.spec.ts`; they never touch a real database (CI has none).
  `@db` is a lazy proxy, so importing it is safe; constructing queries is not.
- Everything else from the root CLAUDE.md still applies: 300-line files, no `as any`, no
  ts-ignore, E-prefixed enums, `handle`-prefixed handlers, named parameters, no comments that
  restate the code.
