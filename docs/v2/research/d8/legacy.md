# D8: Did legacy Atlas run the agent loop in a long-lived backend process with tools executing in a remote sandbox/container?

**Short answer: No — that is the inverse of what legacy Atlas did.** In the legacy cloud stack
(`deprecated/backend`), the agent loop did NOT live in the backend. The backend was a long-lived
**host/control-plane** process that, per turn, spawned a **per-turn engine process inside the remote
sandbox**; the engine (a Node/NestJS bundle launched with a single `TURN_ID`) ran the Claude Agent
SDK loop locally inside the sandbox and executed its tools/commands there. Backend ↔ engine
communication went over **Redis Streams** ("Redis is the sole engine transport"), not a websocket,
HTTP exec API, or in-container daemon protocol — the only remote-exec edge was the single
`kubectl exec` / `docker exec` used to _launch_ the engine turn process. The sandbox itself was
long-lived (privileged Docker-in-Docker); the loop process was not.

Scope note: two generations exist in the frozen tree. `src/host` + `src/engine` + `sandbox/` is the
v3 (k3d/k3s Kubernetes) line; `src/host_old` + `src/engine_old` + `sandbox_old/` is the v2 line
(single-box Docker, marked "Legacy 100% vibe coded unreviewed code, but works 99%" at
`deprecated/backend/src/engine_old/CLAUDE.md:1`). Both share the same shape: per-turn engine process
inside the sandbox, Redis as the transport.

## Where the loop ran

- Backend host process (NestJS, long-lived): `deprecated/backend/src/host/main.ts`; the turn
  dispatcher (`deprecated/backend/src/host/turn/turn-dispatcher.service.ts:44-55`) builds a
  `TurnSpec`, writes it to Redis, and calls `SandboxService.launchEngineTurn(jobId, turnId)`
  (`deprecated/backend/src/host/sandbox/sandbox.service.ts:130-137`).
- That call is the _only_ remote exec: `k8s.execInPod(namespace, pod, MAIN_CONTAINER,
  ['sh','-c', cmd])` at `sandbox.service.ts:135`, running
  `setsid env TURN_ID=… /usr/local/lib/atlas/atlas-engine-turn … &` (`sandbox.service.ts:132`;
  entrypoint constant at `deprecated/backend/src/host/sandbox/sandbox.constants.ts:8`).
- The engine process itself is a small NestJS app booted per turn inside the pod:
  `deprecated/backend/src/engine/main.ts:9-39` (`TURN_ID is required`, `readSpec` from Redis, then
  `runner.run(turnId, spec)`, then `process.exit`). The loop is
  `RunnerService` (`deprecated/backend/src/engine/runner/runner.service.ts:30-56`): it calls
  `this.sdk.query({...})` from `@anthropic-ai/claude-agent-sdk` (import at `runner.service.ts:1`,
  injection at `:25`) and `for await`s SDK messages, re-emitting each to Redis. Tools run inside the
  sandbox via the SDK's normal local Bash/Read/Write machinery; the pod sets
  `CLAUDE_CODE_SHELL_PREFIX=/usr/local/bin/atlas-classify` (`sandbox.service.ts:311`,
  `sandbox.constants.ts:9`) so every agent Bash command is reniced (`sandbox/README.md` "atlas-classify"
  paragraph), and `permissionMode: 'bypassPermissions'` / `IS_SANDBOX=1` (`runner.service.ts`,
  `buildClaudeOptions`; `sandbox.service.ts:313-314`).
- The sandbox is the long-lived piece: a privileged Docker-in-Docker pod per job
  (`deprecated/backend/sandbox/README.md` intro; pod spec `securityContext.privileged: true` at
  `sandbox.service.ts:304-306`), kept alive by a 30-minute Redis lease (`LEASE_TTL_S = 30 * 60`,
  `sandbox.constants.ts:18`) refreshed on engine activity (`sandbox.service.ts:140-142`) and reaped
  by a cron (`sandbox.service.ts:155-177`). Workspace durability via hostPath `$ATLAS_DATA/workspaces/<jobId>`
  (`sandbox.service.ts:285-290`).
- v2 (older) line, same architecture on one Docker host: "PID 1 (sandbox-init.sh) starts an inner
  dockerd (DinD) and idles; the host drives engine turns via `docker exec` into it" —
  `deprecated/backend/sandbox_old/Dockerfile:3-4`; dockerode exec impl at
  `deprecated/backend/src/host_old/sandbox/dockerode-container-engine.ts:137-150` (hijacked stream)
  and `:220-236` (detached exec for turns). Per-turn engine main at
  `deprecated/backend/src/engine_old/main.ts:7-28` (identical `TURN_ID`/Redis shape).
- `deprecated/agent-engine` is unrelated prior art: a never-run `EngineAdapter` port abstraction
  (`deprecated/agent-engine/package.json` description; `deprecated/agent-engine/src/port.ts:34-38`),
  marked "never-run EngineAdapter port" in the repo's root CLAUDE.md deprecated table
  (`/atlas/workspaces/atlas/CLAUDE.md:102`).

## How tool execution reached the sandbox (protocol)

- **No daemon, no websocket, no per-command exec API.** Protocol split:
  1. Control plane → sandbox: one **Kubernetes exec API** call per turn to spawn the engine
     (`sandbox.service.ts:135`; `Exec` from `@kubernetes/client-node` at
     `deprecated/backend/src/_lib/k8s/k8s.service.ts:5,66,173`). In v2, one **docker exec** via
     dockerode (`dockerode-container-engine.ts:150,225`).
  2. All turn traffic after that: **Redis Streams**. Engine reads its spec with a blocking `XREAD`
     (`deprecated/backend/src/engine/engine-transport/engine-transport.service.ts:14-30`), emits
     every SDK event with `XADD` (`:33-35`), and consumes mid-turn steering on a blocking `XREAD`
     loop (`:37-67`, 1s block). Host side mirrors this in
     `deprecated/backend/src/host/host-transport/host-transport.service.ts:32-37` (`writeSpec`,
     `writeInput` via `xadd`) and `:84` (`xread` of the events stream).
  3. Redis is declared the only transport: "the engine reads its turn spec from / streams events to
     Redis; Redis is the sole engine transport, ADR 0001" —
     `deprecated/infra/docker-compose.prod.yml:15` (the ADR itself is not in the frozen tree; only
     references at `deprecated/agent-engine/src/types.ts:520` and
     `deprecated/backend/src/host_old/driver/thread-driver.service.ts:171`). Sandboxes attach to an
     `internal: true` `atlas-bus` network reaching Redis and nothing else (same file, `:12-16`).

## How streaming to clients worked

- Engine → host: every SDK message `XADD`ed to the turn's Redis events stream
  (`runner.service.ts:46-51` loop; `engine-transport.service.ts:33-35`); 20s heartbeats keep the
  lease/live-pointer fresh (`runner.service.ts:14,41-43`).
- Host → browser: **SSE**, not websockets. Nest `@Sse(':jobId/turn/stream')` at
  `deprecated/backend/src/host/job/job.controller.ts:19` wraps
  `HostTransportService.streamLive` (`host-transport.service.ts:58-…`), which tails the turn's
  Redis events stream with 1s blocking `XREAD`s and replays from the turn start for late subscribers
  (`host-transport.service.ts:74-115`). Polling/timeout knobs: `LIVE_POLL_MS 500`,
  `LIVE_BLOCK_MS 1000`, `LIVE_TTL_S 90`, `TURN_STALL_MS 60_000` (`host-transport.service.ts:8-13`).
- Web client consumed it with `EventSource`/SSE manager: `deprecated/web/src/lib/api/sse-manager.ts`,
  `deprecated/web/src/features/job-workspace/hooks/use-job-turn-stream.ts`; the browser hit the
  backend directly (`/web/*` REST, `/web/events` SSE, credentialed CORS —
  `deprecated/web/src/lib/env.ts:16-21`).

## Hosting (deprecated/infra, deprecated/.github)

- **Provider:** a single OVH bare-metal box — "Single OVH box (64 GB, SYS-GAME-2). Docker +
  docker-compose. Caddy for TLS termination." (`deprecated/infra/README.md:3`). Domains
  `app.byatlas.io` / `api.byatlas.io` / `*.preview.byatlas.io` with Caddy + Let's Encrypt
  (`infra/README.md` DNS table). Docker images built and pushed to **GHCR**
  (`ghcr.io/dennisofficial/atlas-backend{,-migrator}`, `atlas-web`, `atlas-caddy` —
  `deprecated/.github/workflows/ci.yml:158-161`).
- **Blue/green:** yes, hand-rolled. `deprecated/infra/deploy.sh` (header `:1-23`) swaps
  `backend-blue`/`backend-green` under a Postgres **advisory-lock leader election** (only the leader
  passes `/health/ready`; drain-then-release with SIGTERM, 300s stop grace, 120s drain-grace code
  constant — `deploy.sh:265-275`, `docker-compose.prod.yml:22-24`), runs the migrator image before
  the swap, verifies `https://api.byatlas.io/health/ready` (`deploy.sh:30`), and records
  `active-color`/`active-tag` under `/srv/atlas/state/`. Web + Caddy are stateless and outside the
  dance (`deploy.sh:239-242`).
- **CI/CD:** `deprecated/.github/workflows/deploy.yml` triggers on successful CI on main
  (`workflow_run`), runs on a **self-hosted runner on the production box**
  (`runs-on: [self-hosted, atlas-box]`, `deploy.yml:24`), gated by a GitHub Environment reviewer
  (`environment: production`, `deploy.yml:28`), then shells out to `infra/deploy.sh sha-<sha>`.
- **Sandbox compute:** same box in v2 (host Docker socket, per-job containers on isolated bridge
  networks + `atlas-bus`; CPU governance via `CpuShares` 256 vs control-plane 1024/2048 —
  `docker-compose.prod.yml` SANDBOX_CPU_SHARES block, `infra/README.md` "CPU governance" section).
  The v3 line moved sandboxes to **k3d locally / k3s on the host in prod**
  (`deprecated/backend/sandbox/README.md` intro and "Operational scripts" paragraph), pods in
  namespace `atlas-sandboxes` (`sandbox.service.ts:43`).

## Documented problems, latency numbers, why paused/abandoned

- **Why paused:** no design doc in the frozen tree gives a postmortem or incident-driven reason. The
  only statements are inventory labels: root CLAUDE.md calls `deprecated/backend` "Paused NestJS
  cloud harness" and `deprecated/web` "Paused Next.js front end" (`/atlas/workspaces/atlas/CLAUDE.md:104-105`),
  and `docs/architecture.md:1698-1699` says "the paused backend/web/shared cloud stack with its CI
  and infra." The current repo's direction is a greenfield rewrite under locked decisions
  (`/atlas/workspaces/atlas/docs/research/cloud-arch-review.md:5-6` — "greenfield: no cloud
  sandboxes in use, the relocation engine is being deleted, every thread is born-placed"). So
  "paused" reads as superseded-by-rewrite, not as a documented failure.
- **v2 quality flag:** `deprecated/backend/src/engine_old/CLAUDE.md:1` — "Legacy 100% vibe coded
  unreviewed code, but works 99%."
- **Documented operational problems (v2/v3, in infra docs):**
  - Docker network-pool exhaustion on a busy box ("all predefined address pools have been fully
    subnetted") → custom `daemon.json` with `10.100.0.0/14` and leaked-network reaping
    (`infra/README.md` §1 "Enlarge Docker's network address pool").
  - Disk fill from image churn: "53% of the 878G RAID-1 mirror was ~360G of reclaimable images";
    each deploy pulls ~6.6G; orphaned sandbox rebuilds ~4.9G each → `docker-gc.sh`
    (`infra/README.md` "Disk / image garbage collection"; `deploy.sh` step 8).
  - Sandbox CPU bursts starving the control plane ("dropped SSE/UI connections") → relative
    `cpu_shares` weights (`infra/README.md` "CPU governance" section).
  - Deploy-window schema risk: expand-contract migrations required because the draining old backend
    serves in-flight turns against the already-migrated schema (`infra/README.md` step 7 blockquote).
  - Engine-priority protection: agent builds reniced (`nice 19`) so they "never starve the engine's
    token stream" (`sandbox/README.md` atlas-classify bullet).
- **Latency numbers:** the only quantitative timing in the tree is polling/heartbeat tuning, not
  measured latency: host SSE tail 500ms idle-poll / 1s blocking reads / 90s live-pointer TTL / 60s
  stall timeout (`host-transport.service.ts:8-13`); engine heartbeat 20s
  (`runner.service.ts:14`); mid-turn forward poll 750ms
  (`turn-dispatcher.service.ts:20`); provision-to-dispatch flow "currently fails at the
  `TurnSpecBuilder` stub" — i.e. the v3 k3d line never shipped end-to-end
  (`deprecated/backend/sandbox/README.md` final paragraph). The v3 spike findings file
  (`sandbox/FINDINGS.md`, referenced in `sandbox/README.md`) is **not present** in the frozen tree.

## Could not pin down

- ADR 0001 (Redis-as-transport rationale) — referenced but not committed under `deprecated/`.
- `backend/sandbox/FINDINGS.md` (S2a DinD de-risking results, incl. any latency/resource numbers) —
  referenced in `sandbox/README.md` but absent from the tree.
- Any explicit document stating _why_ the cloud stack was paused — only "paused" labels and the
  greenfield-rewrite context exist.
