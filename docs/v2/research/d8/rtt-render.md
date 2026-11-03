# D8 — Tool-call round-trip cost from a Render worker into a Vercel Sandbox

**Question:** if the Atlas agent loop runs on a Render control-plane worker in Virginia
(decision [0021](../../../decisions/0021-v2-loop-runs-on-the-agent-host.md)), what does
one tool-call round trip into a Vercel Sandbox (`iad1`) cost over one persistent WebSocket?
Measured 2026-11-02 from a temporary Render Background Worker `atlas-v2-rtt-probe`
(region `virginia`, plan `starter`, image `docker.io/oven/bun:1`, created and deleted via the
Render REST API in the Comp AI workspace). This is the cross-provider counterpart of
[`rtt.md`](rtt.md) (Vercel sandbox → Vercel sandbox).

## Method

- Render service: Background Worker, plan `starter`, region `virginia` (confirmed on the
  service), public image `docker.io/oven/bun:1`. Start command decodes the probe from base64 env
  vars, `bun install`s `@vercel/sandbox` 3.9.1 + `postgres` 3.4.5, runs it. Deploy script:
  [`probe/render-deploy.ts`](probe/render-deploy.ts); probe:
  [`probe/render-run.ts`](probe/render-run.ts) (WS/runCommand paths byte-identical to
  [`probe/run.ts`](probe/run.ts)), in-sandbox daemon
  [`probe/render-ws-server.ts`](probe/render-ws-server.ts) (identical to `ws-server.ts`),
  Postgres probe [`probe/render-pg.ts`](probe/render-pg.ts).
- The probe created one short-lived sandbox per run with `@vercel/sandbox` 3.9.1: image
  `comp-ai/atlas-web/atlas-sandbox:latest`, team `comp-ai`, project `atlas-web`, 15-minute
  timeout, region `iad1` (configured and actual), port 3000 exposed; uploaded the Bun WS server,
  built the 2,080-file grep tree at `/tmp/gtree`, then timed **200 sequential** `exec` / `read` /
  `write` (~300 B) / `grep` requests over one persistent `wss://` connection, a ~180 s idle hold
  followed by a ping, and **30** per-op SDK `runCommand` calls — the same shape as `rtt.md`.
  The local baseline from `run.ts` was dropped: the Render box is not the perf subject.
- Added measurements: **WS connect time ×3** (fresh connections) and **HTTPS GET ×50** from
  Render to the Atlas Cloud API health route `GET https://api.byatlas.io/v1/health` (informs the
  worker → control-plane append budget), plus a **Postgres probe**: connect time ×3 then 200
  sequential `BEGIN READ ONLY; SELECT 1; ROLLBACK` on one connection to the production database
  (`DIRECT_URL`, host `aws-us-east-1-1.pg.psdb.cloud:5432`, PlanetScale us-east-1) with
  `sslmode=verify-full` against system roots.
- Three full runs executed (Render restarts an exited Background Worker, so runs 1–2 were
  before the restart-loop fix; run 3 also carried the Postgres probe). All three sandboxes
  confirmed `stopped`; the Render service was deleted.

## Results (ms, p50 / p90 / p99)

### WS daemon + SDK runCommand — three Render → Vercel runs vs the Vercel → Vercel baseline

| path                      | op    | run 1 p50/p90/p99 | run 2 p50/p90/p99 | run 3 p50/p90/p99 | baseline p50/p90/p99 ([rtt.md](rtt.md)) |
| ------------------------- | ----- | ----------------- | ----------------- | ----------------- | --------------------------------------- |
| **WS daemon** (n=200/op)  | exec  | 19.3/24.1/35.7    | 6.5/10.7/19.9     | 17.0/22.5/34.4    | 6.5/8.6/48.8                            |
|                           | read  | 15.5/22.7/35.2    | 3.1/6.6/23.3      | 14.2/19.4/99.8    | 3.7/5.4/14.4                            |
|                           | write | 15.4/20.9/55.4    | 3.0/5.0/15.1      | 14.2/19.8/31.6    | 3.6/4.7/25.8                            |
|                           | grep  | 39.4/47.8/99.6    | 19.3/25.3/45.3    | 29.9/36.4/93.4    | 18.2/21.5/30.6                          |
| **SDK runCommand** (n=30) | exec  | 71.2/115.6/284.2  | 63.1/82.5/85.2    | 64.6/101.4/228.7  | 57.2/86.6/243.0                         |
|                           | read  | 62.6/86.9/96.3    | 66.9/104.7/169.2  | 62.6/95.7/149.9   | 61.6/85.7/140.4                         |
|                           | write | 65.1/95.4/104.5   | 66.4/98.0/125.8   | 62.2/93.7/157.4   | 59.1/84.7/149.9                         |
|                           | grep  | 96.2/135.8/153.0  | 76.0/122.0/143.7  | 76.7/107.3/119.6  | 81.1/102.7/161.3                        |

### HTTPS RTT — Render → Atlas Cloud API (`GET /v1/health`, n=50)

| run   | p50   | p90   | p99   | min   | mean  |
| ----- | ----- | ----- | ----- | ----- | ----- |
| run 1 | 16.64 | 29.92 | 57.37 | 11.08 | 18.73 |
| run 2 | 16.11 | 31.82 | 66.37 | 9.24  | 20.51 |
| run 3 | 15.29 | 31.46 | 51.14 | 9.64  | 16.82 |

### Postgres — Render → production PlanetScale (`aws-us-east-1-1.pg.psdb.cloud:5432`)

One connection, `sslmode=verify-full` (system roots), 200 sequential
`BEGIN READ ONLY; SELECT 1; ROLLBACK` (TLS on the wire verified by rejecting a bogus CA):

| op                      | p50  | p90  | p99  | min  | max  | n   |
| ----------------------- | ---- | ---- | ---- | ---- | ---- | --- |
| read-only `SELECT 1` tx | 5.54 | 6.60 | 8.35 | 5.03 | 8.48 | 200 |

Connect time ×3 (new connection, TLS handshake + auth): **101.8, 38.8, 35.6 ms**.

## One-time costs

- Sandbox create: 3.39 s (run 1), 2.30 s (run 2), 2.26 s (run 3) — warm image, comparable to
  the 2.37 s of the baseline.
- WS connect ×3: run 1: 68.6/65.8/71.6 ms; run 2: 31.9/30.3/25.2 ms; run 3: 87.9/59.6/58.6 ms.
- Idle hold: in all three runs the WS held fully idle for 180 s stayed open; ping after idle
  answered in 29.3 / 3.3 / 14.4 ms.

## Reading

- **Render → Vercel WS round trip lands within ~10 ms of the Vercel → Vercel baseline at p50
  and is sometimes indistinguishable.** Run 2 measured read/write at 3.0–3.1 ms p50 and exec at
  6.5 ms p50 — at or under the same-region baseline (3.7/3.6/6.5 ms). Runs 1 and 3 measured
  ~14–19 ms p50 on the same ops. Both endpoints are in us-east-1 (Render Virginia ↔ Vercel
  `iad1`), so the spread between runs is instance/placement variance on the `starter` plan, not
  a systematic cross-provider penalty; the planning number for slice 3 should be **~5–20 ms p50
  per tool call** over one persistent WebSocket.
- **`runCommand` per call is unchanged at ~62–96 ms p50** — it is dominated by the Vercel-side
  HTTPS round trip plus command spawn, identical from Render or from a sibling sandbox. The WS
  daemon remains ~4–10× cheaper per call.
- **Worker → control-plane appends cost ~15–17 ms p50 over HTTPS** (`api.byatlas.io`, p90 ~30 ms,
  p99 ~51–66 ms) — small against model time per turn, but worth batching/pipelining in the
  write-behind path rather than blocking per event.
- **Worker → Postgres is ~5.5 ms p50 per read-only round trip** (p99 8.4 ms) with TLS — cheap
  enough for direct lease/record access; connection setup is 36–102 ms, so pool connections.
- The `*.vercel.run` proxy holds an idle WebSocket from Render exactly as it does in-region
  (180 s verified three times).

## Cleanup

Render service `atlas-v2-rtt-probe` (`srv-dbkfbld6e07s73cac21g`) deleted via the API (GET after
delete → 404, name search → 0 services). All three sandboxes
(`d8-rtt-render-1793652249302`, `d8-rtt-render-1793652486791`, `d8-rtt-render-1793652691568`)
confirmed `stopped` via `Sandbox.get().status`. No writes were made to the production database
(read-only transactions only). Nothing was committed; raw result JSON was printed to the Render
logs (`RESULTS_JSON` / `RESULTS_JSON_FINAL` marker lines).

## Surprises

- **Render restarts an exited Background Worker immediately** — the first probe ran twice before
  the start script was changed to end in `sleep infinity`. Budget for that when running one-off
  jobs this way.
- **Bun's `Bun.SQL` did not apply TLS** (`tls: true` or URL `sslmode=verify-full`) to the
  PlanetScale endpoint in Bun 1.4.2 (local validation) and 1.4.4 (the Render image) —
  `pg_stat_ssl` reported `ssl: false`. The `postgres` npm package honors `ssl: 'verify-full'`;
  the probe uses it and asserts TLS is on the wire by confirming a bogus CA is rejected.
- **Run-to-run WS variance is large on the `starter` plan** (run 2 matched the in-region
  baseline; runs 1 and 3 were ~10–13 ms above it). If the worker's tool-call budget matters,
  re-measure on the production plan before locking the budget.
