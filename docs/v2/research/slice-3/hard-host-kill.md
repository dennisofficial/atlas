# Hard host kill against the Render agent host (2026-11-08)

Goal: do once, live, what the fault rows do to the agent host with SIGKILL, and record what the user's
session does.

## What was available

| Route                                                    | Result                                                                                                                                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Render REST API                                          | no instance-level action: `GET /v1/services/{id}/instances` lists `-glc6n`, `-jt4r8`, … but there is no kill/terminate endpoint (`/v1/openapi.json` is 404; the documented surface is restart, suspend, resume, rollback) |
| SSH (`srv-dbmaj7ajnfac738tg30g@ssh.virginia.render.com`) | `Permission denied (publickey)` — no key is registered for this pod, and there is no API to add one                                                                                                                       |
| `POST /v1/services/{id}/suspend`                         | accepted (202), but it **freezes** the instance rather than killing it — see below                                                                                                                                        |

## What suspend actually does (measured)

Session `de884fc5-8e64-484c-8f5b-4c0057e15c58`, one Render instance `…-jt4r8`, a real tool call running:

| time (Z)  | event                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------- |
| 07:41:16  | `tool-dispatched bash` boot `86234d57-…` (`head -c 150000000 /dev/urandom > /tmp/blob; bzip2 -9`)                         |
| 07:41:23  | `POST /suspend` → 202                                                                                                     |
| 07:41:44  | logs for the window contain **no `draining` line from `jt4r8`** (only the two earlier deploy drains from `glc6n`/`tlmxp`) |
| 07:41:45  | `POST /resume` → 202                                                                                                      |
| 07:41:48  | `tool-result` for the same `callId`, `interrupted=false`, text `"1"`                                                      |
| 07:41:48  | `assistant-said`, then `branches-observed`; final status `idle`, lease **epoch 1**, same holder                           |
| 07:41:45+ | no `agent-host started` / `stream listening` line after the resume                                                        |

No SIGTERM was delivered, no new process booted, and the lease never changed hands, so the instance was
paused (cgroup freeze) and thawed — not killed. That is a useful datapoint but it is **not** the SIGKILL
shape.

What the freeze did prove live: a 22 s total freeze of the host during a real 60 s tool call loses nothing —
the call completed in the sandbox, the same holder appended its result once (marker file shows run count 1),
and the turn finished at `idle`.

## Side finding: a long tool call has to be real work

The first attempt asked for `sleep 150`; the sandbox policy refused it in under a second ("this command
spends 150 seconds asleep…") and `runInBackground` is not available on v2 sessions yet, so any live test
that needs a long call must use real work (the `bzip2 -9` above takes ~60 s at 100% CPU).

## SIGKILL, done locally against production (2026-11-08, 08:01Z)

A SIGKILL of the Render host is not reachable, but the same kill **is** reachable one layer down: run an
agent host in a pod with the production env, have it hold a real session on the production control plane
and a real Vercel sandbox, then `kill -9` it. Render was suspended for the window so the local host wins
the claim deterministically.

Session `727d0e06-c5ab-4cb5-8497-c1fbc263206b`, `bun --preload ./src/config/load-production-env.ts
src/main.ts`, `PORT=20001`.

| time (Z) | event                                                                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 08:01:31 | host A (local) up; session created; `bzip2 -9` job posted                                                                                                           |
| 08:01:54 | session `running-tool`; lease epoch 1, holder 162, live                                                                                                             |
| 08:02:02 | `kill -9` to host A's process group; the process reports `signal=SIGKILL`                                                                                           |
| 08:02:05 | host B (local, `PORT=20002`) started                                                                                                                                |
| 08:02:06 | status `running-tool`, lease **epoch 2**, holder 161 — reclaimed in about 3 s                                                                                       |
| 08:02:11 | `tool-result` `interrupted: true` — "bash was interrupted by a process restart before its result was recorded; its effects are unknown — check before repeating it" |
| 08:02:12 | the model read `/tmp/blob` and `/tmp/hard-kill-runs` and reported **1**                                                                                             |

So the SIGKILL path works end to end with a real sandbox: the record is intact, the next holder claims in
seconds, the crashed call is settled as interrupted rather than silently re-run, and the side effect
appears exactly once (marker file one line). It also shows the deliberate difference from the F11 fault row:
there the daemon keeps the call and the next holder _collects_ it; under a real SIGKILL the call is settled
interrupted and the model is told its effects are unknown.

Caveat for anyone repeating this: `POST /suspend` cancels a deploy in flight, and `POST /resume` starts a
fresh build, so the production host is the better part of five minutes with no instance — do it only when
no session is live.

## Verdict

The Render host itself cannot be SIGKILLed from here (no kill API, no shell), but SIGKILL of a holder is
proven twice: by the local fault rows (`f23`, `f10`–`f15`, `f43`) with real processes and a scripted daemon,
and by the run above with a real process, the production control plane and a real Vercel sandbox. The
suspend experiment adds the freeze datapoint. Recorded in
`docs/v2/research/slice-3/live-exit-tests.md`.
