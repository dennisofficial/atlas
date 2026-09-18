# e2e-cloud

A local end-to-end proof of the cloud transition path. Everything runs against a throwaway
Postgres container and a throwaway API boot — nothing touches production or Vercel.

```
sh scripts/e2e-cloud/run.sh
```

Requires docker, bun, and node. The runner creates a `postgres:16-alpine` container, migrates it,
builds and boots the API, runs the three phases, and tears everything down on exit.

## What each phase proves

- **transfer-up.mjs** — the lift's transfer is idempotent: a replayed `POST /v1/threads/open`
  answers 201 rather than 500, a replay carrying new events appends only the novel tail, and a
  diverged or shortened replay is refused with 409 instead of clobbering the cloud copy.
- **serve-turn.mts** — a sandbox serve runs a turn end to end: the sandbox row's token
  authenticates the sessions/accounts routes, the socket handshake backfills and streams the
  model's answer (a local OpenAI-compatible mock via `OPENROUTER_BASE_URL`), the answer and the
  turn ledger land in the control plane, a dead model surfaces a legible failure to the client
  instead of a hang, and a parked serve wakes and runs the next turn.
- **transfer-down.mjs** — the location flips to host and back, the log survives both moves, and a
  re-lift appends rather than duplicating.

## Env overrides

`E2E_PG_PORT` (5544), `E2E_API_PORT` (3401), `E2E_SERVE_PORT` (3402), `E2E_MOCK_PORT` (3403),
`E2E_PG_HOST` (localhost; use `host.docker.internal` when running inside a container),
`E2E_PG_CONTAINER` (the throwaway container's name).
