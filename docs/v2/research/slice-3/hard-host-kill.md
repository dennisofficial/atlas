# Hard host kill against the Render agent host (2026-11-08)

Goal: do once, live, what the fault rows do to the agent host with SIGKILL, and record what the user's
session does.

## What was available

| Route | Result |
| --- | --- |
| Render REST API | no instance-level action: `GET /v1/services/{id}/instances` lists `-glc6n`, `-jt4r8`, … but there is no kill/terminate endpoint (`/v1/openapi.json` is 404; the documented surface is restart, suspend, resume, rollback) |
| SSH (`srv-dbmaj7ajnfac738tg30g@ssh.virginia.render.com`) | `Permission denied (publickey)` — no key is registered for this pod, and there is no API to add one |
| `POST /v1/services/{id}/suspend` | accepted (202), but it **freezes** the instance rather than killing it — see below |

## What suspend actually does (measured)

Session `de884fc5-8e64-484c-8f5b-4c0057e15c58`, one Render instance `…-jt4r8`, a real tool call running:

| time (Z) | event |
| --- | --- |
| 07:41:16 | `tool-dispatched bash` boot `86234d57-…` (`head -c 150000000 /dev/urandom > /tmp/blob; bzip2 -9`) |
| 07:41:23 | `POST /suspend` → 202 |
| 07:41:44 | logs for the window contain **no `draining` line from `jt4r8`** (only the two earlier deploy drains from `glc6n`/`tlmxp`) |
| 07:41:45 | `POST /resume` → 202 |
| 07:41:48 | `tool-result` for the same `callId`, `interrupted=false`, text `"1"` |
| 07:41:48 | `assistant-said`, then `branches-observed`; final status `idle`, lease **epoch 1**, same holder |
| 07:41:45+ | no `agent-host started` / `stream listening` line after the resume |

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

## Verdict

A live SIGKILL of the Render host is **not reachable from this environment**: the platform exposes no kill
and no shell. SIGKILL stays covered by the local fault rows (`f23-sigkill-ring`, the new command-death row),
and this run records the closest available live shape (a total freeze with the lease held) plus the
discovery that Render's suspend is a pause. Recorded in `docs/v2/research/slice-3/live-exit-tests.md`.
