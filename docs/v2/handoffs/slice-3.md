# Handoff: Atlas v2, start slice 3 (worker host + sandbox daemon)

Written 2026-11-02 at the end of the slice 2 session. Everything this file refers to is in the
repository; nothing from that session's scratch or context folder survives.

## Before starting

- Slice 2 is done: #1696, #1702, #1703 merged (shipped through v1.202.20). D8 merged as #1706.
- Branch from `origin/main` as `dennis/v2-worker-host`.

## Read, in order

1. `docs/v2/README.md`
2. `docs/v2/roadmap.md`: Current state ("Next: slice 3") and the slice 3 row (goal, exit criteria,
   must-settle list)
3. `docs/decisions/0021-v2-loop-runs-on-control-plane-workers.md`: the loop runs on control-plane
   workers, the sandbox daemon, the clean handoff on a worker restart, the durability guarantees
4. `docs/v2/architecture.md` §3, §11, §12, §13; decisions 0018-0020
5. `docs/v2/slices/01-record-core.md` (the `ControlPlane` interface the worker calls) and
   `docs/v2/slices/02-agent.md` (the `agent` ports the worker supplies: record, model context,
   intake, output, tools)
6. Evidence: `docs/v2/research/d8/` (round-trip measurement and its probe scripts, production
   tool calls per turn, host providers, legacy prior art) and `docs/v2/research/slice-2/` (v1
   `harness` censuses; anchors at `5203552d4` and may have moved)

## The job

Write `docs/v2/slices/03-worker-host.md`, walk the operator through it point by point, and build
nothing until it is approved.

## Settled, and where it is recorded

- **Worker:** a separate `apps/worker` service (plain Bun, no Nest or tRPC), a Render Background
  Worker in Virginia, in the Render **Comp AI** workspace (`tea-cvi2tf7noe9s73aqppe0`). The API
  stays on Vercel. Recorded in 0021 and the roadmap.
- **Render access:** the API key is the Atlas Cloud project secret `RENDER_API_KEY`, exported to
  every shell. It was validated against `GET https://api.render.com/v1/owners`. Create the Render
  service only once `apps/worker` exists on a branch. The operator must make sure Render's GitHub
  app can see `dennisofficial/atlas`; the API cannot grant that.
- **Measure first:** the first deliverable is the round-trip probe run from Render into a Vercel
  `iad1` sandbox. The Vercel-to-Vercel baseline and the scripts that produced it are in
  `docs/v2/research/d8/rtt.md` and `docs/v2/research/d8/probe/` (it uses `VERCEL_TOKEN`, also a
  project secret).
- **Clean pause is a requirement:** a worker restart pauses each loop at a step boundary and hands
  the lease on; only an in-flight model stream is lost (0021, "A worker restart is a clean
  handoff").
- **Owned by later slices, already in the roadmap:** one session per sandbox disk, branch and PR
  tracking from git refs, ~1 s append latency (slice 3) and ~1 s open-to-current (slice 5), local
  pods clone rather than mount (slice 9).
- **Follow-up after slice 2, specified but not built:** superseding a thinking-only request
  (`docs/v2/slices/02-agent.md`, "Follow-up after slice 2").

## How the operator works

- He approves specs point by point. Explain each point in plain terms, not method names; he does
  not read the code.
- He expects evidence for each recommendation: production data, measurements, primary sources.
- He approves each push, PR and merge. v1 must not change behaviour, and he restarts and tests v1
  after merges.
- Delegate builds to sub-agents with a written brief, then verify independently. In slice 2 a
  reviewer and a mutation check caught a real ordering bug the builder missed.
- The repo formats markdown with Biome (`bunx biome check --write`), not Prettier.
- Read-only production queries: in `apps/api`, `bunx dotenvx run -f envs/.env.api.production.enc`,
  psql with `sslrootcert=system`, inside `BEGIN READ ONLY`. The v1 `Turn` table is stale (no rows
  since 2026-09-26), and a `runId` spans many user messages
  (`docs/v2/research/d8/prod-tool-calls.md`).

## Suggested skills

`atlas` (services, cloud secrets), `codebase-design` (seams: worker host, daemon, execution port),
`tdd` (agree seams before tests), `code-review`, and `handoff` at the end.
