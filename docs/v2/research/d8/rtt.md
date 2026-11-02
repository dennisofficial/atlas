# D8 — Tool-call round-trip cost into a Vercel Sandbox

**Question:** if the Atlas agent loop ran on a long-lived host outside the sandbox, what does one
tool-call round trip into a Vercel Sandbox cost? Measured 2026-11-02 from this Atlas session,
which itself runs inside a Vercel Sandbox — a fair approximation of a long-lived host in the same
region (both measured sandboxes: region `iad1`, configured and actual).

## Method

- **One** short-lived sandbox `d8-rtt-1793646383770`, created with `@vercel/sandbox` 3.9.1:
  image `comp-ai/atlas-web/atlas-sandbox:latest` (the VCR image the release workflow pushes;
  repo defaults in `apps/api/src/_core/config/env/sections/sandbox.ts`), team `comp-ai`,
  project `atlas-web`, 15-minute timeout, region `iad1`, port 3000 exposed. Sandbox creation
  took **2.37 s** (warm image).
- Inside it: a Bun WebSocket server (`ws-server.ts`, port 3000) handling `exec` (Bun.spawn),
  `read` (Bun.file), `write` (Bun.write), `grep` (`rg --files-with-matches` over a generated
  2,080-file tree at `/tmp/gtree`). Bun found at `/opt/mise/shims/bun`.
- From this sandbox: one persistent `wss://` connection to the exposed domain
  (`https://sb-3lebvuuk4cn3.vercel.run`), 200 sequential requests per op, timing per request
  (send → full response). Then 30 calls per op via the SDK's `sandbox.runCommand` (no daemon —
  one command object per call, stdout drained, `wait()`ed). Then the same ops executed locally
  in this sandbox as baseline (200 per op).
- Idle test: WS held open ~180 s with no traffic, then a `ping` — proxy kept the connection;
  ping answered in 4.12 ms.

Scripts: [`probe/`](probe/) — `run.ts` (orchestrator), `ws-server.ts`
(in-sandbox daemon), `stop.ts` (cleanup helper), `results.json` (raw stats).

## Results (ms, p50 / p90 / p99)

| path                                 | op                 | p50  | p90   | p99   | n   |
| ------------------------------------ | ------------------ | ---- | ----- | ----- | --- |
| **WS daemon** (one persistent conn)  | exec               | 6.54 | 8.64  | 48.8  | 200 |
|                                      | read               | 3.68 | 5.42  | 14.4  | 200 |
|                                      | write (~300 B)     | 3.59 | 4.69  | 25.8  | 200 |
|                                      | grep (2,080 files) | 18.2 | 21.5  | 30.6  | 200 |
| **SDK runCommand** (per call)        | exec               | 57.2 | 86.6  | 243.0 | 30  |
|                                      | read               | 61.6 | 85.7  | 140.4 | 30  |
|                                      | write              | 59.1 | 84.7  | 149.9 | 30  |
|                                      | grep               | 81.1 | 102.7 | 161.3 | 30  |
| **local baseline** (in this sandbox) | exec               | 3.03 | 3.56  | 4.12  | 200 |
|                                      | read               | 0.06 | 0.08  | 0.63  | 200 |
|                                      | write              | 0.04 | 0.05  | 0.23  | 200 |
|                                      | grep               | 11.6 | 14.2  | 16.1  | 200 |

One-time costs: sandbox create **2.37 s**; WS connect **41.7 ms**.

## Reading

- **Network penalty per WS round trip ≈ 3.5–6.5 ms p50** over the local baseline
  (read: 3.68 vs 0.06; write: 3.59 vs 0.04; exec: 6.54 vs 3.03; grep: 18.2 vs 11.6).
  Same-region sandbox-to-sandbox RTT through the `*.vercel.run` proxy is single-digit ms.
- Tail: p99 spikes to 25–49 ms on exec/read/write — proxy jitter, not a systematic cost.
- **Per-call `runCommand` is ~10–15× slower than the WS daemon**: ~57–81 ms p50 (plus a fat tail,
  p99 up to 243 ms) — each call is an HTTPS round trip plus command spawn on the Vercel side.
  At p50 the overhead vs the WS daemon is ~50–60 ms per tool call; vs local it is ~55–78 ms.
- **Proxy supports WebSocket upgrade and long-lived idle connections**: upgrade connected in
  41.7 ms; a connection held fully idle for 180 s stayed open and answered a ping in 4.12 ms.

## Cleanup

Sandbox `d8-rtt-1793646383770` stopped at the end of the run and confirmed `stopped` via
`Sandbox.get().status`. No repo files were touched; all scripts live under
[`probe/`](probe/).
