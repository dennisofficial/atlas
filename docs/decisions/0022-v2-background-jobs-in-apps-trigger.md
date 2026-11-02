# 0022. v2 background jobs and schedules run on trigger.dev in `apps/trigger`

Proposed 2026-11-02; accepted when the operator merges the PR that adds it.

## Context

v1's trigger.dev tasks live inside the API: `apps/api/src/trigger/`, deployed from
`apps/api/trigger.config.ts`, with the worker bundle shipping the API's own tier file
(`apps/api/trigger-tier-extension.ts` copies `envs/.env.api.production.enc`). The tasks are thin
wrappers that build a service graph by hand and call into API code: they import 48 distinct
modules from `src/api`, `src/_lib` and `src/_core`. The boundary between API and worker is a test
(`apps/api/src/api/trigger-boundary.spec.ts`), not a package edge.

trigger.dev is a separate deployment with its own runtime, its own secrets and its own release
cadence. Comp AI's `comp-neo` monorepo models it that way: `apps/trigger` is its own app with its
own `trigger.config.ts`, its own encrypted tier files and its own database role; task ids and
payload schemas live in `packages/jobs` (zod only); logic both apps use lives in domain packages.
The API starts tasks by id through `packages/jobs` and never imports the worker, and a task never
imports `apps/api`.

[0021](0021-v2-loop-runs-on-the-agent-host.md) adds a second long-running service, the agent host,
which must not become a home for background work.

## Decision

**v2 background jobs and schedules run on trigger.dev, in their own `apps/trigger` app.** Every
v2 job, cron and sweep is a trigger.dev task; none runs as a timer in the API or the agent host.
- **Its own app and deploy.** `apps/trigger` owns `trigger.config.ts`, the trigger.dev SDK,
  `@trigger.dev/build` and the CLI. The API keeps only the SDK, behind one dispatcher file.
- **Its own keys.** `apps/trigger` has its own encrypted tier files carrying only what its tasks
  need, decrypted at worker start. It never ships the API's tier file.
- **Contracts in `packages/jobs`.** Task ids and zod payload schemas live there, depending on zod
  only. The API dispatches by id through it.
- **Shared logic in packages.** `apps/trigger` never imports `apps/api`, and `apps/api` never
  imports `apps/trigger`. Logic both need lives in a foundation package or a plugin
  ([0019](0019-v2-package-map.md)); the package graph enforces the rule instead of a boundary spec.
- **Its own trigger.dev project.** v2 deploys to a new project, separate from v1's
  (`proj_yvwotwceptrneuuasamk`), so task ids and schedules cannot collide and retiring v1 deletes a
  whole project.

**v1 stays where it is.** `apps/api/src/trigger/` keeps running and takes fixes only; it is not
extracted. It is removed with the rest of v1 at slice 10.

## Why

- trigger.dev is a different deployment from the API; its code, dependencies and secrets should be
  too, and a package edge is checked by the compiler where a boundary spec is checked by convention.
- Doing this in v2 avoids extracting v1 code that v2 deletes: the §13 reconciler replaces v1's
  wake claims, rotation recovery and cron sweeps (`stuck-session-sweep`, much of `pod-provision`).
- v1's GitHub sweeps are still being fixed (#1688, #1693, #1701); a refactor under them would
  collide with live fixes.

## Consequences

- `apps/trigger` is built when v2 first needs a job, after the reconciler exists, so the set of
  jobs is known. Nothing is built by this record.
- GitHub jobs in v2 depend on the GitHub plugin (roadmap slice 7), not on a copy of v1's
  `apps/api/src/api/cloud/github`.
- Until v1 retires there are two trigger.dev deployments.
