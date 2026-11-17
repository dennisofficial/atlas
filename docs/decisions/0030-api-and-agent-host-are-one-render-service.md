# 0030. The API and the agent host run as one Render service

Accepted 2026-11-17. Supersedes the "a new `apps/agent-host` service … with the API staying on
Vercel" clause of [0021](0021-v2-loop-runs-on-the-agent-host.md) and its rejection of moving the
whole API to Render. Reading its last consequence against
[0029](0029-agent-host-is-a-nest-http-app.md), the stream and the operator routes are now that one
module of `apps/api`.

## Context

0021 kept the API on Vercel and gave the loop its own Render service, rejecting "moving the whole API
to Render and running loops in it" because Render's shutdown grace caps at 300 s, so every API merge
would cut every running turn. Two services on one database bought two boot paths, two env tiers whose
shared keys are byte-identical, two shutdown stories and two request pipelines — and the API's Vercel
shape (Build Output v3, `waitUntil`, a per-instance in-memory throttler, an `@Interval` sweeper gated
on `VERCEL !== '1'`) to keep working for a runtime that exists only because of the loop.

The objection was never the restart, it was the turn: a deploy that waits for a turn lasting minutes
to hours is not shippable. #2314 removed that. On drain a holder pauses every loop it holds at once,
detaches running daemon calls, aborts the in-flight model request and releases its leases; the next
holder resumes from the record at the next epoch. The worst case is one repeated model request.

## Decision

**D1. One Nest app, one Render web service, both hostnames.** `apps/agent-host` becomes a module of
`apps/api` loaded by the long-lived entry; the same service answers `api.byatlas.io` and
`agent.byatlas.io`. Hostnames do not change: the MCP `redirect_uri` is sealed into pending rows as
`${AGENT_HOST_PUBLIC_URL}/mcp-oauth/callback`, and the web, mobile and Mac clients hold their origins
in config.

**D2. Everything a client calls is tRPC.** Operator answers and MCP sign-in begin become procedures,
and `/stream` a tRPC subscription, on the router and origin the API already serves; the host's
unversioned controllers, its own CORS list and its bearer guard go with them. What stays plain HTTP
is what a browser or a provider sends by itself: `/api/auth/*`, the webhooks, `/v1/health`, the
draining `/healthz`, and the `/mcp-oauth/callback` redirect that a provider opens.

**D3. Background work stays off the service.** Schedules and jobs stay on trigger.dev in
`apps/trigger` ([0022](0022-v2-background-jobs-in-apps-trigger.md)). The `@Interval` GitHub sweeps
that ran when `VERCEL !== '1'` are deleted rather than re-enabled on Render, because the trigger.dev
schedules already run the same sweeps; an in-process flag keeps them for local dev only.

**D4. Vercel keeps the API until the DNS cutover.** The Vercel deployment stays up, on the same
Postgres, as the rollback. `api.byatlas.io` moves to Render only after TLS on the Render origin is
verified, so rolling back is a DNS flip, not a migration.

## Reason

The 300 s cap only mattered while a restart waited for a turn. With the handoff instant, a deploy
costs one repeated model request, and one user has no population of sessions to lose. Against that,
the merge deletes a service boundary rather than writing an adapter: 0029 already put the host on
Nest, the two tier files already carry the same secrets, and the host already calls the API for
nothing ([0027](0027-both-backends-own-their-work.md)). A long-lived process also removes the Vercel
constraints the design worked around rather than needing a second runtime to satisfy them.

## Consequences

- A deploy restarts the loop and the API together. Every running turn pauses at the handoff and
  resumes on the new instance from the record; nothing waits for a turn to finish.
- The Vercel boot stays working and loads no host module until the flip; after it, the Vercel project
  is retired in a later record. Both boots read the same database, so they must not both serve
  `api.byatlas.io`.
- Vercel-shaped code loses its home: `waitUntil` becomes an in-process keepalive, the sweeper gate
  goes, and the throttler and better-auth rate limit count per process instead of per function
  instance — stricter than before, since the service is always on.
- The single public port carries the stream, so the SSE reconnect ceiling of the serverless API
  stops shaping the protocol; cursors stay, because a deploy or a dropped socket still reconnects.
- The API's 4 MB body limit, versioning and exception filter apply to host routes now, and the host
  routes stay unversioned, so no client path changes at the flip.
