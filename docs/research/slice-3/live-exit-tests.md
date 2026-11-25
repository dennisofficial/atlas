# Slice 3 live exit tests (production, 2026-11-05)

Run against Render `atlas-agent` (standard, virginia, scaled to 2 for the fault rows), `api.byatlas.io`, PlanetScale `v2` and real Vercel sandboxes, as Dennis. Scripts lived in a gitignored `apps/agent-host/.scratch/` and are not kept; each section says what it did.

## Summary

| Test                           | Result                                                           |
| ------------------------------ | ---------------------------------------------------------------- |
| 8 append latency               | PASS (p99 237 ms, earlier run)                                   |
| 9 hog                          | PASS after #1890 (first run: OOM not shown in the tool result)   |
| 10 20k events                  | PASS (claim 118 ms, first step 2.7 s)                            |
| F10 kill mid model stream      | PASS (step re-asked, first step 142 ms after claim)              |
| F11 kill mid bash              | PASS (collected by the new holder, run count 1)                  |
| F12 SIGTERM during a long bash | PASS after #1893 (first run: drained host exited 1 at 5 s)       |
| F18 stop the sandbox mid turn  | PASS after #1892 (first run: no resume while held; bash re-ran)  |
| F19 both hosts down            | PASS (run count 1, record intact)                                |
| F21 holder killed while waking | PASS (reclaim 37 ms, same sandbox, run count 1)                  |
| Deploy mid turn, stream client | PASS (going-away, closing 1001, resume by cursor, no gap or dup) |

Bugs found (all fixed in #1889–#1893 and rerun live; see "Reruns" at the end):
1. OOM kill reaches the model as `Exit code: 1` (`packages/host/src/calls/ports/process.ts:18`).
2. SIGTERM drain dies 5 s in with exit 1 before `holder.drain`. Cause (#1893): the `dotenvx run` wrapper in `start` forwards SIGTERM after 1 s (the old second-signal `process.exit(1)` fired) and its execa child is SIGKILLed 5 s later.
3. Stopped sandbox is never re-woken while held (`apps/agent-host/src/runtime/session-runtime-factory.ts:72-90` wakes once per runtime), and the resumed daemon re-runs the interrupted call (cause, #1892: `DaemonProcessPort` never passed the recorded dispatch bootId, so the cross-boot guard skipped exec).
4. Keep-alive always fails: `renewSessionDeadline` (`apps/agent-host/src/sandbox/vercel-sdk.ts:59`) compares the Vercel `sbx_…` session id with the Atlas session id.
5. Status stays `thinking` after the reply when a record-only event (`branches-observed`, a stop's `input-consumed`) follows it (`packages/core/src/record/session-status.ts:99`).

## Log

### Prior results (handoff, 2026-11-05)

- **Test 8 PASS:** `at` → client p99 237 ms over 27 events, 5 turns.
- **Test 10, claim only:** 20k-event session claimed in 68 ms, first step 126 ms (`holder.takeover`).
  The follow-up message went unanswered; suspected cause: seed called `plane.grant` with a fake host id while a
  real host held the session, then `revoke({wantsHolder:false})`. Session deleted. Re-run required.

### This session

### Test 10 re-run — PASS (2026-11-05 18:52Z)

Session `24d101aa-10b3-4e8d-bbf8-5b1724ef7588`. Seeder (`apps/agent-host/.scratch/test10.ts`, gitignored) creates the
session and thread **without** `notifyWake`, writes the lease row at epoch 1 to a fake host in the same transaction
(so no real host can claim before the seed), appends 20,000 hash-chained `branches-observed` filler events in
500-row batches (6.4 s), then `revoke({wantsHolder:false, epoch:1})` → epoch 2, no holder. Then subscribe + post.
- `holder.takeover`: **claimMs 118**, configMs 293, recordMs 2669 (loading 20k events), firstStepMs 2746.
- Post → `workspace-prepared` 26.9 s (fresh sandbox + clone + install, as on 2026-11-04), `user-said` 27.0 s,
  `assistant-said` **28.5 s**. Message answered; inbox consumed at seq 20002. Stream: no gaps, no dups.
- The previous run's unanswered message is explained by the seed's state (grant to a fake host while a real
  host held it), not a wake-path bug: this run's wake path (post → `PG_WAKE_CHANNEL` → claim) worked first time.
- Record load at 20k is 2.7 s of the first step: claim is well under 2 s, but `ownEvents` materialization
  (spec "Open, not blocking") is worth doing before sessions reach that size routinely.

**Bug found:** after the reply, `sessions.status` stays `thinking` (`since` = seq 20005, a `branches-observed`
appended by the branch observer after `assistant-said`). `sessionStatusOf`
(`packages/core/src/record/session-status.ts:99`) treats the last event as the turn's state, and a record-only
`branches-observed` is not turn-ending. Any session whose branch set changes at the end of a turn shows
"thinking" forever.

### Test 9 hog — run 1 (2026-11-05 18:58Z), session `24d101aa-…` (`.scratch/hog.ts`)

CPU: `seq $(nproc) | xargs -P0 -I{} timeout 300 sh -c 'yes > /dev/null'` via bash, stop posted after 30 s
(`plane.post kind:stop`; there is no API route for stop yet, so the script posts it to the inbox directly).
Memory: `cat /sys/fs/cgroup/atlas-work/memory.max; head -c 64G /dev/zero | tail | wc -c`.
- **Stop:** `tool-result` (`interrupted: true`) **210 ms** after the stop was posted. PASS (< 2 s).
  Next turn: `pgrep -c yes` → 0, so the box was killed and nothing leaked.
- **Presence/lease held:** 61 status samples over the run: holder 31, epoch 3, `live` true every time, no takeover. PASS.
- **Daemon survived:** every `tool-dispatched` carries the same `bootId` `c4a1d904-…` before, during and after
  both hogs. PASS.
- **Daemon reachability from outside (HTTP GET to the daemon's routed URL from this pod, every 200 ms, so it
  includes Vercel's edge and the pod→iad1 path):** baseline p50 10 / p99 45 ms; CPU hog p50 10 / p99 52 ms
  (max 71); around stop p99 112; memory balloon p99 276 ms; after p99 27; 0 failures in 628 probes.
  This is not the spec's daemon ping (that is host↔daemon over the WebSocket); run 2 measures from inside the
  sandbox.
- `atlas-work` memory.max = 2,881,982,464 B (2.68 GiB).
- **OOM: FAIL — not shown in the tool result.** The balloon's box was killed (stdout has memory.max but no
  `wc -c` output, exit code 1, daemon unaffected), yet the model saw only `Exit code: 1`.
  `DaemonProcessPort.exitCodeOf` (`packages/host/src/calls/ports/process.ts:18`) maps `EExecOutcome.OomKilled`
  with a null exit code to plain `1`; the outcome never reaches `BashTool`, whose result has only `exitCode`,
  `timedOut`. Fix: carry the exec outcome through the `ProcessHandle` (or a sentinel code + reason) and render
  "killed: out of memory (limit N)" in `renderModelText`.

### Test 9 hog — run 2 (2026-11-05 19:03Z, `.scratch/hog2.ts`): daemon latency inside the sandbox

A detached `curl localhost:3000` probe every 100 ms inside the sandbox for 75 s (a stand-in for the host↔daemon
ping, without the Vercel edge in the path), the same all-cores CPU hog for 35 s, then stop.
- Daemon answer time: **during hog p50 0 / p99 0 / max 1 ms (n 305)**; outside the hog p99 1 ms (n 348). PASS (< 50 ms).
- Stop → `tool-result` 241 ms. PASS.
- `atlas-work/memory.events` after run 1's balloon: `oom 2, oom_kill 4, oom_group_kill 1`: the kernel killed the
  workload box (`memory.oom.group=1` per box), the daemon in `atlas-serve` was untouched (same bootId).
- Status after the stop reads `thinking` (last events: interrupted `tool-result`, then the stop's `input-consumed`),
  the same class of bug as test 10's: `sessionStatusOf` has no turn-ending rule for a stopped turn or for
  record-only events after the reply.

**Test 9 verdict:** lease/presence held, daemon p99 well under 50 ms, stop < 2 s, kernel killed the hog's box
not the daemon: PASS. "The OOM shows in the tool result": **FAIL** (exit code 1 only); fix listed above.

### F18 stop the sandbox mid-turn — FAIL (2026-11-05 19:18Z), session `ee1690fd-84c2-49fb-b520-5d6c1159fd1f`

Two hosts (31, 32). Three sequential bash calls; `sandbox.stop()` (Vercel SDK, Dennis's credentials) 15 s into
call 2 (a 120 s sleep). bootId `f76e9f56-…`.
- After the stop (19:19:01) the record got **no further events for 9+ minutes**: no `tool-result`, no new bootId,
  status `running-tool`, lease epoch 1 on host 31, `live: true`. The holder never resumed the sandbox.
- **Cause:** `session-runtime-factory.ts:72-90` calls `sandbox.wake()` once per runtime and the connector
  returns `webSocketConnector({ url: (await endpoint).url })` forever after. When the sandbox stops, `Link`
  reconnects with backoff to the stopped sandbox's routed URL; nothing re-runs `wake()` (resume + relaunch the
  daemon), so `SandboxUnavailableError` is never raised and the call hangs. The local F18 spec passes because the
  rig's daemon comes back at the same URL.
- **Second bug, every session:** keep-alive always fails: `renewSessionDeadline`
  (`apps/agent-host/src/sandbox/vercel-sdk.ts:59`) asserts `sandbox.currentSession().sessionId` (a Vercel
  `sbx_…` id) equals the Atlas session id, which is never true. Logged every renew for both this session and the
  test-10 session (`refusing to renew sandbox …: its live session sbx_… is not the session …`). So no sandbox's
  timeout is ever extended; a long turn outlives its sandbox.

### Unplanned: auto-deploy of `aff28197d` drained both hosts (2026-11-05 19:29–19:32Z)

Old hosts 31 (held test-10 session idle + the hung F18 session) and 32 (nothing held); new hosts 33, 34.
- Host 32: `draining` 19:31:38.39, presence gone 19:31:38.56. Clean.
- Host 31: `draining` 19:31:48.18. The idle test-10 session was revoked `wantsHolder:true` within ~200 ms and
  claimed by host 33 (epoch 4→5): **claimMs 59, recordMs 2013 (20k events), firstStepMs 2130**; its next event was
  a `nudge` + `assistant-said` (the resumed loop re-asked the model once).
- Host 31 then died **5 s into the drain with `script "start" exited with code 1`** without handing off the F18
  session (still epoch 1 on host 31). Host 33 took it over only after 31's presence vanished, via host-watch
  ("woke 1 sessions needing a holder"; claimMs 17). Suspected cause: `main.ts:115`
  (`if (shuttingDown) process.exit(1)`) — Render signals the process group, so `bun run start` and the agent-host
  child both see SIGTERM (the wrapper forwards it), the second delivery exits 1 mid-drain. Host 32 had nothing to
  drain so exited before a second signal mattered. To confirm in a local spec.
- F18 session on host 33: it woke the stopped sandbox and booted a new daemon (19:31:56, "no matching daemon —
  booting it"), but **still no new event 1+ min later** (status `running-tool`, seq 8 `tool-dispatched`): the new
  holder does not settle the call dispatched on the old bootId. So F18 fails on both halves (no resume while
  held; no interrupted-result after resume).

### F10 / F11 / F12 + deploy mid-turn with a stream client — Render restart (2026-11-05 19:34–19:40Z)

Two sessions on host 33: `3a3bd1cc-d9c2-448f-b555-461b90d67a42` (bash: python 330 s wait, dispatched 19:34:13,
bootId `e2bdef54-…`) and `b8f586c6-f66c-4013-97a2-62926e620138` (model writing a long list, turn started 19:37:23).
Two stream clients subscribed (one per session). `POST /services/…/restart` at 19:34:28; Render rolled 33/34 → 35/36.
- Host 33 SIGTERM: `draining` 19:38:40.65, then **`script "start" exited with code 1` at 19:38:45.70 (5.05 s)**.
  Same as host 31 earlier (5.04 s). No `holder.drain` handoff happened; both sessions were picked up as if the
  holder had been killed. 5.0 s matches `STREAM_DRAIN_TIMEOUT_MS` (`stream-limits.ts:9`): the process dies right
  after `stream.drain`, before `holder.drain` can hand off. Cause unconfirmed (no `shutdown failed` log line);
  candidates: the second-signal `process.exit(1)` at `apps/agent-host/src/main.ts:115`, or the `bun run start`
  wrapper. Needs a local repro under `bun run start` with a process-group SIGTERM.
- Takeover by host 36 at 19:38:45.98: bash session **claimMs 28, firstStepMs 189**; writer **claimMs 77,
  firstStepMs 142**. ~5.3 s from SIGTERM to resumed (well inside "≤ ~90 s").
- **F11 (holder dies mid bash): PASS.** The bash kept running on the daemon; host 36 (epoch 2) collected it:
  one `tool-dispatched` (epoch 1), one `tool-result` `done-rollmw3y1l18` (epoch 2) at 19:39:43 = 330 s after
  dispatch, exit 0, then the reply. Same bootId, so no rerun.
- **F10 (holder dies mid model stream): PASS as the kill shape.** No `assistant-said` from host 33 for the
  in-flight step; host 36 re-asked the step and replied at 19:40:16 (epoch 2). `resuming` was not observed: the
  presence handover was faster than the 1 s status sampler.
- **F12 (SIGTERM during a long bash → graceful handoff ~1 s): FAIL as specified.** The work survived, but via the
  crash path at 5 s, not a drain handoff (no `revoke wantsHolder:true` before exit).
- **Deploy mid-turn, stream client: PASS.** Each client got `going-away` (538 / 1478 ms), then `closing{1001}`,
  reconnected 0.7 s / 1.6 s later with `afterSeq` + `afterHash`, and continued at seq 6 / 11 with no gap or duplicate.
- A further auto-deploy (`2428224de`, #1882) started at 19:42 during the writer's later turns.

### F18 epilogue (read 19:46Z): the turn finished, but the stopped bash ran twice

After host 33 resumed the sandbox (new daemon 19:31:56), the record went on: seq 9 `tool-result`
`done-sbxmw3xhnac` (epoch 2, 19:33:56, i.e. 120 s after the new daemon booted), seq 10–12 the third call on bootId
`fb8b3089-…`, seq 13 reply. Inside the sandbox (uptime 14 min, so a new VM; /tmp survived the stop):
`/tmp/fault-runs-sbxmw3xhnac` has **two** lines, `run-1793906318` (19:18:38, original dispatch) and
`run-1793907116` (19:31:56, after resume).
- **The bash call was re-run on the new boot without a new `tool-dispatched`** (seq 8 is the only dispatch, on
  the old bootId `f76e9f56-…`). The spec (F17/F18, three invariants) says a side-effecting call interrupted by a
  boot change is reported interrupted, and only read-only calls rerun. **F18: FAIL** — resume only happened on a
  holder change (not while held), and the interrupted bash ran a second time.

### F21 holder killed while waking a parked sandbox — PASS (2026-11-05 20:01Z), session `3a3bd1cc-…`

Session parked (no holder, epoch 3); its sandbox stopped through the Vercel SDK. Posted a bash message; host 44
claimed 139 ms after the post (epoch 4), appended `input-consumed` + `user-said` and began the model step while
the sandbox resumed. 1.5 s later the script `pg_terminate_backend`ed host 44's presence connection (the live
equivalent of the holder dying: the lease's presence vanished).
- Host 44 logged `presence lost; dropping 1 held sessions`; its workspace setup and git watch were fenced
  (`closed its daemon link`). Status went `resuming` (live false) at once.
- The same process re-registered as host 45 and re-claimed: **claimMs 37, firstStepMs 52** (epoch 5), ~1.1 s
  from kill to `thinking` again. It reused the same sandbox (`atlas-v2-3a3bd1cc-…`; daemon booted under the flock,
  one bootId `37c86dd5-…` for both later calls), re-asked the step, and no tool ran under epoch 4.
- Run count 1 (`/tmp/fault-runs-wake…` has one line). Stream: no gaps, no dups.

### F19 both agent hosts down at once — PASS (2026-11-05 20:02–20:17Z), session `366fbc30-b19b-4fcc-992e-352493e6ce62`

Bash (python 150 s wait) dispatched on host 43 at 20:02:53 (bootId `0289dc8b-…`), then `POST /services/…/suspend`
at 20:03:03 (both instances). Host 45 left at once; host 43's presence lingered until ~20:05 and then the
record showed `live:false` with no host. The script died before resuming (my harness bug); resumed manually at
20:12:35 (`service_resumed` deploy went live 20:16:57; hosts 46, 47). ~14 min with no agent host at all.
- Host 46 claimed (epoch 2) as soon as it registered and collected the bash, which had finished on the daemon
  while no host existed: `tool-result` `done-suspmw3z2khr` exit 0, then the reply. Record intact, no gaps.
- `/tmp/fault-runs-suspmw3z2khr` in the sandbox: one line → **run count 1**.
- v2 downtime was acceptable: Dennis confirmed nobody uses the Render v2 host before slice 5.
### Reruns after the fixes (#1889–#1893), 2026-11-05 evening

### Test 9 OOM rerun — PASS (21:42Z)

Fresh session, same balloon (`head -c 64G /dev/zero | tail | wc -c`, atlas-work memory.max 2,881,982,464).
`tool-result`: `oomKilled: true`, exit code 137, model text "The kernel killed the command because it ran out of
memory: it exceeded the sandbox's memory limit. Retrying it unchanged will fail the same way, so reduce its memory
use … Exit code: 137". Status after the reply: `idle` (the #1891 fix, live).

### F12 rerun — PASS on the failing half (21:44–21:52Z), session `eb45a69b-f9fa-4953-bca5-9a555a8423b5`

Bash (480 s python wait) dispatched on host 52 at 21:44:20 (epoch 1); `POST /restart` at 21:44:31; two hosts (52, 53).
- Host 53: `draining` 21:49:11.8, gone at 21:49:12.2, **no `exited with code 1`**.
- Host 52 (holder): `draining` 21:51:32.4, **no crash**. It kept draining 48 s, the bash finished on the daemon at
  21:52:20.6 and host 52 appended the `tool-result` itself (epoch 1), then revoked (epoch 2) and host 55 claimed at
  21:52:20.97 (epoch 3; claimMs 71, firstStepMs 154) and wrote the reply. Lease hand-off took ~0.4 s.
- Run count 1 (`/tmp/fault-runs-f12mw42p1t1`).
- Note on the spec's "handoff ~1 s": in production the drain deadline is 270 s (`main.ts`), so a holder finishes a
  running call inside that window before handing off; it hands off a still-running call only once the deadline passes
  (local F12 uses `drainMs: 500`). The bug — dying 5 s in with exit 1 — is gone.

### F18 rerun — PASS (21:53–21:54Z), session `5400b8c5-a20b-4803-b47b-d5b574f166d3`

Three bash calls; sandbox stopped (Vercel SDK) 15 s into call 2 (120 s wait). Holder never changed (epoch 1 throughout).
- 5 s after the stop: `tool-result` for call 2 with `interrupted: true` (21:54:13.98), no rerun.
- The holder re-woke the sandbox itself: next dispatches carry a new bootId `9abd9601-…` (was `73e25239-…`).
- The model checked the runs file (one line) and continued; call 3 ran; reply. `/tmp/fault-runs-…` run count **1**.
- The model saw the interrupted message (context assembly reads `error` before `modelText`). The stored
  result also kept the tool's own `modelText` (`Exit code: 1`), which the fault script logged and the loop
  detector (`loop-watch.ts`) reads; #1897 clears it in the interrupted rewrite.
- Unrelated log: `holder.claim … lease changed concurrently` on host 55 at 21:53:20 — both hosts raced to claim the
  new session and one lost; benign.

## Leftovers (2026-11-08)

### A hard kill of the Render host: not reachable, and suspend is a freeze

The API lists instances (`GET /v1/services/{id}/instances`) but has no kill or terminate action, and the
service's SSH address refuses a keyless login, so there is no way from a pod to SIGKILL the process.
The kill _is_ reachable one layer down, and was done: a local agent host on the production control plane
and a real Vercel sandbox, `kill -9`, next holder claimed in ~3 s, the crashed call settled interrupted and
the side effect counted once — see [hard-host-kill.md](hard-host-kill.md). `POST /suspend`, the most abrupt
stop Render itself offers, was measured during a real 60 s tool call on session
`de884fc5-8e64-484c-8f5b-4c0057e15c58`: the instance logged no `draining`, no new `agent-host started`
followed the resume, and the lease stayed at epoch 1 with the same holder — it paused and thawed rather
than died. What that run does prove: a 22 s total freeze during a running call loses nothing; the call
finished in the sandbox and the same holder appended its result once (run count 1). Full record in
[hard-host-kill.md](hard-host-kill.md). SIGKILL itself stays covered by the local fault rows.

### The 2026-11-07 drain-log mismatch: dropped

The `draining` line is the retiring instance's SIGTERM handler, and Render starts the replacement before
terminating the old instance, letting it drain up to `maxShutdownDelaySeconds` (300 s). So a drain
timestamp sits after the replacement's `agent-host started` — by up to five minutes — and consecutive
deploys overlap while an older instance is still draining (on 2026-11-07 `-99zwb` was still launching a
sandbox daemon 25 s after it logged `draining`). Expected rolling-deploy behaviour, not a lost handoff.
