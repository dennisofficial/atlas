# Handoff: Atlas v2 slice 3, PR 3, continue from the session holder

Written 2026-11-03 at the end of the session that built PR 3's first five parts. Everything is in
the repository, on GitHub or in Atlas Cloud project config; nothing from that session's scratch survives.
Read with [../slice-3-pr3.md](../slice-3-pr3.md) (the previous handoff, still valid for how the daemon is built)
and the spec [../../slices/03-agent-host.md](../../slices/03-agent-host.md).

## Where things stand

PR 3 was split into slices, each its own PR. Merged:

| PR    | What                                                                                                                                                                                                                                                                              |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1766 | Control plane: leases on the DB clock (`clock_timestamp()` read after the row lock), `V2Session` owner columns, `createSession` with its main thread, `listSessions` (≤100), `sessionsNeedingHolder`, `revoke({ wantsHolder })`. Migration `20261103T1907_v2_sessions_placement`. |
| #1770 | `packages/jobs` + `apps/trigger` with the every-minute `reconcile-holders` task. trigger.dev project "Atlas v2" `proj_muqwamionbikynuchupc` (org DL Technologies) and its tier file exist; **not deployed**: no CI deploy job yet.                                                |
| #1774 | API session routes and the agent-host config routes.                                                                                                                                                                                                                              |
| #1778 | `packages/host` remote calls: one daemon link per session, reconnect/reattach, fencing, `recoverCall` row 5 before `run`, call-scope keys, daemon-backed `ProcessPort`/`FileSystemPort`/`AgentFileSystemPort`, new daemon op `readLink`.                                          |

**Open: #1787** (branch `dennis/v2-drop-allowlist`). It opens the session routes to every signed-in user, drops the
`v2` prefix from names (tRPC `sessions.*`/`agentHost.*`, env `AGENT_HOST_TOKEN`/`DAEMON_SECRET`, Redis
`atlas:session-wake`/`atlas:session-live:<id>`, task `reconcile-holders`), sets `AGENT_HOST_TOKEN` in the API's
production tier, and adds this handoff. CI was green before the last pushes. **Merge it first** once CI is
green again (v1 is unaffected; merge without asking).

## The job, in order

1. **Merge #1787.**
2. **Slice 5: `SessionHolder`** in `packages/host/src/holder`. The full spec is [sections/05-session-holder.md](sections/05-session-holder.md),
   written against the merged host API and the new names. It includes a control-plane `claim` that refuses a live
   lease, because **`grant` takes the lease even from a live holder**, so two hosts woken together would each take it.
   This is the biggest remaining slice. Give it to one builder with a time box, or split the record adapter + OnceLedger
   from the holder loop.
3. **Slice 6: `apps/agent-host`.** Not specced yet. A plain Bun process: build the `SessionRuntimeFactory` (mount
   the sandbox `atlas-v2-<sessionId>` with `wire`'s `mountWithRetries`, upload and start the daemon bundle from
   `apps/daemon` (`bun run build` → `bin/daemon.js`), `webSocketConnector` to the routed URL, harness model adapters and
   builtin tools (bash, read, write, edit, multi_edit, grep, glob) over the daemon-backed ports), config from
   `agentHost.*` with `AGENT_HOST_TOKEN`, Redis wake/live, SIGTERM → `drain` with a 270 s deadline. Exit seam: spec
   "Seams under test" 1, with two processes, test Postgres and a local daemon.
4. **Create the Render service** once `apps/agent-host` is on a branch: `atlas-agent-host`, Background Worker, Standard,
   2 instances, Virginia (oregon is wrong), Comp AI workspace `tea-cvi2tf7noe9s73aqppe0`, `maxShutdownDelaySeconds: 300`,
   auto-deploy from `main` filtered to `apps/agent-host`, `apps/daemon` and the packages it imports. Env: `DATABASE_URL`,
   `REDIS_URL` (copy from the API production tier), `AGENT_HOST_TOKEN`, `DAEMON_SECRET` (both Atlas Cloud project
   secrets), `ATLAS_API_ORIGIN=https://api.byatlas.io`. The operator approved creating it (2026-11-03). Render's
   GitHub app already sees the repo. `RENDER_API_KEY` is exported to shells.
5. **Deploy the trigger task**: a CI job (or a one-off `trigger deploy` from `apps/trigger`) once the agent host
   exists, so wakes have a consumer.
6. **PR 4**: the live exit tests, the fault matrix, docs (roadmap Current state, architecture §5), the slice 4 handoff.

Locked choices: [decisions.md](decisions.md), a copy of the session's decision log, with the names corrected
to the post-#1787 names. Every later slice follows it.

## Secrets and config (values never in the repo)

- Atlas Cloud **project secrets**: `DAEMON_SECRET`, `AGENT_HOST_TOKEN`, `RENDER_API_KEY`, `TRIGGER_ACCESS_TOKEN`
  (a trigger.dev PAT, which can create projects and set env vars through the management API), `VERCEL_TOKEN`.
- Project **file mount** `apps/trigger/envs/.env.keys` holds `DOTENV_PRIVATE_KEY_TRIGGER_PRODUCTION` (also set in
  the trigger.dev project's prod env).
- `AGENT_HOST_TOKEN` is in `apps/api/envs/.env.api.production.enc` (via #1787).

## How the operator works (new this session)

- He wants v2 named as the future, not as "v2": no `v2` prefix where a plain name is free.
- He wants it open: no allowlists ("~3 people use Atlas").
- He noticed agents running for over an hour and asked why. **Time-box every builder** in its brief (20–40 min),
  keep briefs to one slice, and don't add requirements mid-build. A builder that is past its box gets a "converge
  now, push a draft with what fails" message.
- When a v2 session is opened in atlas-web/mac (slice 5), its whole thread page must use only the v2 procedures
  (decisions.md, first entry).
- Still true: merge v2 PRs without asking when v1 is unaffected; ask before new kinds of production
  infrastructure; short reports; never force-push.

## Lessons from this session

- **A spec-level `vi.mock('@dltech/atlas-db')` (bun `mock.module`) leaks into every spec file in the same bun
  process.** It broke ~29 unrelated api specs in CI only (CI runs them in one process; a single file locally
  passes). Inject a port instead (`ProjectAccess` in #1774).
- **Changing a shared test fixture's defaults breaks other specs**: `trpc-middleware.fixture.ts` returned
  `undefined` for every env key after a builder's change. Run the whole api suite (`cd apps/api && bun test`, ~4.5 min;
  20 Redis specs fail locally only because the pod has no Redis) before pushing api changes.
- Postgres `now()` is the **transaction start**; a lease check after waiting on a lock needs `clock_timestamp()`.
- Builders' tests can pass while proving nothing: the row-5 recovery test never reconnected, so disabling
  the check passed. Do the mutation checks yourself.
- `prisma migration ref set` drops `invariants` from `refs/db.json`; restore them by hand after re-planning on a merge.
- `gh run view --log-failed` is unavailable until the whole run finishes; wait for the "CI finished" notice.
- `mac-app-rehearsal` once failed on a GitHub `hashFiles` 120 s timeout, not on the PR; rerun or ignore.
- Builders died twice on Atlas Cloud 500s while their work was green on disk. Check the worktree, stop the
  agent, and finish it yourself rather than respawning.

## Worktrees from this session (disposable)

`/atlas/workspaces/atlas-{control,host,api-v2,trigger,v2-public}`. Only `atlas-v2-public` has unmerged work
(#1787), and it is all pushed.

## Suggested skills

`codebase-design` (keep `SessionHolder` deep: two methods, everything else internal), `tdd` (each fault case
before its fix), `atlas` (services, Render/trigger setup), `code-review` or a reviewer agent per PR, and
`handoff` at the end.
