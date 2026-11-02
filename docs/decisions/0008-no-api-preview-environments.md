# 0008. The API has no preview environments

Accepted 2026-10-19.

## Context

Vercel builds a preview of `atlas-api` for every branch. The previews failed at boot, because the
API's tier key exists only for production, and nobody acted on them. Making them work would have
meant a staging tier, a preview key and database preview branches.

## Decision

No API preview environments, now or later. No staging deploy tier and no database preview branches.
The Vercel bundle always builds against the production tier (`apps/api/build.ts`).
- Pre-merge proof of a Vercel build: `apps/api/src/vercel-bundle.integration.spec.ts`, which runs the
  built function in a read-only `oven/bun` container (`apps/api/test/bundle-container.ts`) under
  `ATLAS_LIVE_DOCKER=1`.
- Post-merge proof: the production deploy.

## Why

A preview that always fails is noise, and a staging tier is upkeep a small team doesn't need.

## Consequences

- A broken API change shows up in production, so the bundle spec and the vitest suite carry the
  weight before merge.
- Production migrations run from the `migrate-production` job in `.github/workflows/release.yml`,
  which gates Vercel promotion as a Deployment Check.
