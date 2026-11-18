# 0008. The API has no preview environments

Accepted 2026-10-19.

## Context

Vercel builds a preview of `atlas-api` for every branch. The previews failed at boot, because the
API's tier key exists only for production, and nobody acted on them. Making them work would have
meant a staging tier, a preview key and database preview branches.

## Decision

No API preview environments, now or later. No staging deploy tier and no database preview branches.
Production is the one Render service (`apps/api`), which autodeploys `main`.
- Pre-merge proof: the `apps/api` suite under Bun, against docker Postgres and `test-redis`
  (`ATLAS_LIVE_DOCKER=1` for the specs that need a container).
- Post-merge proof: the production deploy, gated by the `render-live` job in
  `.github/workflows/release.yml`.

## Why

A preview that always fails is noise, and a staging tier is upkeep a small team doesn't need.

## Consequences

- A broken API change shows up in production, so the test suite carries the weight before merge.
- Production migrations run as the Render pre-deploy command
  (`bun run --cwd apps/api db:migrate:predeploy`) and abort the deploy when they fail, so the previous
  instance keeps serving.
