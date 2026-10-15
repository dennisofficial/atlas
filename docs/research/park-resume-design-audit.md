# Park/Resume Lifecycle — Design Audit

**Date:** 2026-10-15. **Trigger:** the operator hit the "this sandbox is parking and accepts no
new work" wedge again on v1.106.3 — a week after phase 1 (#1216–#1219) shipped to kill it.
Reported scale: "99% of my sandboxes now say it's parking and not accepting new work. Before it
was fantastic." This is a read-only design audit: no production code changes. All anchors are at
`origin/main` d5a4d2b22.

---

## 1. How park + resume actually work today

### 1.1 The park path (serve-side, idle-driven)

**Trigger.** The idle timer is `startServeIdleStop` (`apps/serve/src/idle-stop.ts:54-102`), armed
at the end of every boot (`apps/serve/src/serve-boot-finish.ts:275-288`) — since #1216,
`checkpointAllowed` is unconditionally true (`apps/serve/src/serve-rotation-recovery.ts:114`), so
the timer arms on every boot. Defaults: park after 5 min quiet, 30 min when services are running
(`idle-stop.ts:3-4`), tick 30s. The due decision is pure (`packages/core/src/execution/lifecycle.ts:18-40`)
and resets on any activity. When due it calls `lifecycle.park()` (`serve-boot-finish.ts:287`).

**What park does** (`apps/serve/src/serve-lifecycle.ts:67-150`), in order:

1. Latches a process-local `parking` flag and closes admission:
   `admission.closed = true` + intake suspend (`:69-71`).
2. Refuses and reopens if work is active (`:74-79`).
3. Halts the idle timer, kills all shells/services/children (`:80-82`).
4. Appends a `parked` marker to the transcript and hand-publishes it because the raw event-log
   port emits nothing (`:83-103` — the comment at `:100-102` admits this is a workaround).
5. **Finalizes**: writes a checkpoint with `phase: parked` to the drive
   (`runtime-checkpoint-binding.ts:59` → `runtime-checkpoint.ts:152-188`), mirrored to the API
   (PUT `/v1/sandboxes/:threadId/checkpoint`, `runtime-checkpoint.ts:71-107`). Capturing `Parked`
   **seals the capture for the life of the process** (`runtime-checkpoint.ts:185`) — this runtime
   can never publish a `running` checkpoint again.
6. Broadcasts `Parked` to clients and closes their sockets at 1001 (`:113` →
   `socket-session.ts:257-264`).
7. Stops the sandbox at the provider (`sandboxPark` → `VercelDriver.stop`,
   `apps/serve/src/sandbox-park.ts:4-20`), with 3 retries.
8. `close('idle-park')` + `exit(0)` (`:117-118`).

**The admission flag is a bare mutable object.** `const admission = { closed: false }` is created
at `serve-boot-finish.ts:52` and passed **by reference** into five writers:

| Writer | File:line |
|---|---|
| lifecycle `close()` | `apps/serve/src/serve-lifecycle.ts:37` |
| lifecycle `park()` | `serve-lifecycle.ts:70` |
| drain binding `closeAdmission` | `apps/serve/src/serve-drain-binding.ts:44` |
| recovery `guard()` | `apps/serve/src/serve-rotation-recovery.ts:75` |
| recovery `drain()` | `serve-rotation-recovery.ts:144` |

and five reopeners (`reopenAdmission` at `serve-lifecycle.ts:60`, drain reopen at
`serve-drain-binding.ts:48`, `release` / `continueParent` / `releaseFailedDrain` at
`serve-rotation-recovery.ts:90,98,150`). Two readers produce the operator-visible refusal: the
socket frame gate (`apps/serve/src/socket-session.ts:151-154` — the literal string
"this sandbox is parking and accepts no new work", defined at `apps/serve/src/serve-outcome.ts:10`)
and the turn-driver refusal (`apps/serve/src/serve-driver.ts:27-30`). Health exposes it as
`admissionClosed` (`serve-boot-finish.ts:246`). There is no enumeration of who may close it, no
invariant pairing close/reopen, no owner — it is a shared boolean.

**API behavior on a parked checkpoint:** storage only. The checkpoint PUT conditionally upserts
`runtimeCheckpoint`/`runtimeCheckpointRevision` on the sandbox row
(`apps/api/src/api/platform/sandboxes/sandbox-checkpoint.controller.ts:48-97`) and **never flips
`row.state`, never stops the sandbox, never clears `sealedToken`**. The `state: Parked` column is
written only by the API-initiated stop path (`sandboxes.service.ts:312-319`) and the wake-failure
release (`github-sandbox-wake.service.ts:182-191`). A serve-initiated idle park therefore leaves
the row saying `Running` while the checkpoint says `parked` — two records, two vocabularies,
reconciled lazily by status probes (`sandbox-endpoint.ts:51-70`).

### 1.2 The wake/resume path

**Who initiates.** Three entry points, all converging on the same wire-layer boot primitives
(`packages/wire`: `mountWithRetries`, `createServeLauncher`, swap lock):

- **Client wake** — any `send`/`run`/`request` on a channel in `Parked`/`Closed` state fires
  `kickWake` (`packages/harness/src/cloud/remote-delta-channel.ts:654-666`, call sites `:813-855`),
  and the turn runner gates its drive on `ensureAttached()` → `channel.beginWake()` + injected
  `wake()` (`remote-turn-runner.ts:151-162,193`). The wake itself is
  `bridge.sandboxes.create(...)` → `VercelDriver.createOrResume` → `provisionSandbox`
  (`packages/harness/src/cloud/vercel-driver-provision.ts:122-237`). Reattach
  (`local-cloud-reattach.ts:5-11`) is literally the same call, so wake and reconnect share the
  whole provision path. In-process dedupe by name (`vercel-driver.ts:68-96,290-298`); cross-process
  dedupe by the in-sandbox flock (`packages/wire/src/sandbox-swap-lock.ts`, #1219).
- **API wake** — PR/CI events only: `GithubSandboxWakeService` claims the row Parked→Resuming and
  `VercelSandboxWakeBoot.boot` deletes the stale sandbox, remounts the drive, launches serve
  (`apps/api/src/api/cloud/github/github-sandbox-wake-boot.ts:55-163`), flips the row to Running.
  Failure rolls back what it created and releases the claim (`:143-162`,
  `github-sandbox-wake.service.ts:182-191`).

**What reads the parked state.** `probeSandboxForResume`
(`packages/harness/src/cloud/resume-probe.ts:185-311`) — and this is the crux of the whole audit —
**never reads the runtime checkpoint and never reads the API row**. It infers the lifecycle stage
fresh, from three unrelated signals: provider status (`:220-237`), in-sandbox stamp files
(`SERVE_VERSION_PATH`/`SERVE_PROTOCOL_PATH` via `runCommand`, `:239-252`), and — only on the
rotation path — a `/v1/health` curl (`probeRuntimeActivity`, `:100-125`). Its verdict enum
`ESandboxProbe` (`:14-20`: Missing/Kept/Replaced/RotationNeeded/Swapped) is a *decision about what
to do next*, not a lifecycle state. The provider-`stopped` branch is the wake-from-parked path:
resume in place and swap serve (`:230-232`, → `Swapped`).

**Reattach.** `provisionSandbox`: ensureDrive → probe → `mountWithRetries` → launchServe → return
placement, with rollback deleting only what the call created (`:38-71,223-236`). On the serve side,
boot over parked state is safe at HEAD: `admission.closed = false` from construction
(`serve-boot-finish.ts:52`); the only boot-time closer is `recovery.guard`, and only for a
*foreign-session* rotation receipt (`serve-rotation-recovery.ts:68-84`); a same-session receipt is
`sourceRestart`, consumed and deleted without latching (`:34-39,71-74` — the #1216 fix). A fresh
`running` checkpoint at revision N+1 unconditionally overwrites the parked one (revision-fenced at
`sandbox-checkpoint.controller.ts:67-82`).

**Transcript replay.** Serve rematerializes the transcript from the drive archive at boot
(`apps/serve/src/serve-boot.ts:118-141` — failure aborts the boot). Client-side, the Hello carries
`lastEventSeq`; the greeter either resumes from the frame buffer or emits
`EServeFrame.Reload{sinceEventSeq}` (`apps/serve/src/socket-greet.ts:33-90`), and the channel
re-snapshots from the durable head on a gap (`remote-delta-channel.ts:469-490`). A mid-turn
interrupted by rotation is re-run by `continueParent` (`serve-rotation-recovery.ts:94-101`).

**The reconnect ladder** (`remote-delta-channel.ts`) is a fifth, implicit state machine:
`Connecting → Open → Reconnecting → Reattaching → Parked/Waking/Closed` (`EChannelConnection`,
`:52-60`), with backoff retries (max 8, `:708-719`), a first-cycle lifecycle probe that reads the
API row to decide Reattach vs Parked (`local-cloud-bootstrap.ts:106-120`), escalation to reattach
with a `generation` fence on every async continuation (`:608-646`), and a
3-identical-failures → Closed terminal for queued-work wakes (`:594-636`, #1218). This ladder is
the "reconnect" the operator experiences as wake; it is disconnected from every other record of
the same lifecycle.

### 1.3 The park outcome matrix — where admission can stay closed in a live process

`serve-lifecycle.ts:67-150` has seven branches; three of them leave admission latched in a
process that keeps running:

| Branch | Condition | Admission | Recovery |
|---|---|---|---|
| Refused (work active) | `:75-79` | reopened | fine (#1197) |
| Pre-finalize failure | throw before finalize | reopened | fine (#1197) |
| Finalize success | `:110-119` | closed | process exits — fine |
| **Post-finalize stop failure ×3** | `:114-129` | **closed, live process** | idle timer re-armed (`:130-131`) — retry only if `rearmIdle` supplied |
| **Throw between finalize and retry loop** | e.g. `args.log`/`handlers.park` throws at `:112-113` with `finalized=true` | **closed, `parking=true` forever** | none — `park()` re-entry blocked at `:68`, timer halted, no re-arm |
| Legacy exit (no VERCEL_* env) | `:104-109` | closed, exits | no parked checkpoint written at all |
| Guarded rotation boot | `serve-rotation-recovery.ts:75` | closed | only `recover()`/`activate()` reaching `release()` (`:90`) reopens; a throw in `recover()` (e.g. `startChildren` rejects, `:119`) leaves it latched |

The checkpoint seal (`runtime-checkpoint.ts:185`) compounds the last-middle rows: once `parked` is
captured, that process can never overwrite it with `running` — the API keeps showing
`phase: parked` for a serve that is in fact alive and refusing.

## 2. Why the wedge recurs

### 2.1 The precise mechanism

The wedge #1216 fixed is genuinely fixed at this HEAD — every boot path initializes admission open
and every resume path through recovery reopens it (§1.2). The recurrence is a **different latch
with a blind spot in front of it**, in two parts:

**Part A — a serve can still wedge itself alive.** The park outcome matrix (§1.3) has live-process
latched branches that no phase-1 PR closed. The sharpest: `serve-lifecycle.ts:110-113` — a throw
between a successful `finalizePark()` and the provider-stop retry loop (the `args.log` call or
`args.handlers.park(...)` — the latter iterates sockets and closes them, plausible on a dying
socket) leaves `finalized=true`, admission closed, the process-local `parking=true` (which blocks
`park()` re-entry at `:68`), the idle timer halted, and no re-arm. **Nothing in that process can
ever reopen admission.** The #1216 re-arm (`:130-137`) covers only `stopSandbox` failures *inside*
the retry loop, not throws before it. The triple-stop-failure branch (`:114-129`) is a milder
version: latched by design, dependent on the re-armed timer actually retrying — during a Vercel
API outage the sandbox sits wedged-but-alive, indistinguishable from the permanent case.

The checkpoint seal makes it sticky: once `phase: parked` is captured, `runtime-checkpoint.ts:185`
seals the capture for the life of the process, so the wedged serve keeps mirroring `parked` to the
API and can never publish `running` again. Every observer — the operator, the API row, the parked
transcript tail — sees "parked"; the process is alive and refusing.

**Part B — the wake/keep path cannot see the wedge.** The wedge detector added in #1210
(`wedgeProofOf`, `packages/harness/src/cloud/serve-drain-client.ts:68-77`: admission closed AND
every work signal present and empty) lives **only on the drain seam** — reached from
`requireSafePreparation` (`:101-137`) during a *rotation*, i.e. only when the probe already decided
to replace the serve. But the probe's keep verdict never looks: on a provider-`running` sandbox
whose stamps match the pin, `probeSandboxForResume` returns `Kept` (`resume-probe.ts:297-298`)
**without ever curling `/v1/health`**. The launcher then keeps the serve because it answers health:
`createServeLauncher` (`packages/wire/src/sandbox-serve-launch.ts:161-170`) treats "alive + token
matches + not drifted + `serveHealthy`" as keep — and `serveHealthy` is a bare HTTP-200 check
(`:79-86`: `curl -sf ... -o /dev/null`), which never parses the body. A wedged serve answers
`/v1/health` with 200 and `admissionClosed: true` in the payload (the wedge health shape is
literally defined in `serve-drain-client.ts:49-60`) — and the launcher reads none of it.

So the loop the operator experiences: send → `kickWake` → reattach → probe → `Kept` → launcher
"keeping it" → socket greets fine (greeting is not admission-gated) → every non-read-only frame
refused with "this sandbox is parking and accepts no new work" (`socket-session.ts:151-152`) →
send again → same `Kept` verdict. The wedge is self-healing nowhere on this path: not in the
process (Part A), not in the probe (no health read), not in the launcher (no body parse), not in
the drain gate (never reached), not in the API (checkpoint mirror is storage-only; the wake
service reads `row.state`, which a serve-initiated park never flips).

**Which part is new since "fantastic"?** The wedge holes (Part A) predate phase 1 — #1216 narrowed
but did not close them. What changed in the phase-1 window is the *system around them*: hot-swap
(#1183) and the in-sandbox swap lock (#1219) made "resume in place and keep the sandbox" the
dominant path (recreate-from-image was rejected, decision #1), so a wedged-but-running serve is
now *preserved across wakes by design* instead of being destroyed and recreated as a side effect
of an outdated-version rotation. The version stamp is the only swap trigger on the keep path — and
on v1.106.3 the wedged serve and the pin agree, so nothing ever fires. The wedge didn't get worse;
the blast containment around it was removed.

**Verification boundary.** Whether the production wedge cases were provider-`running` (Part B
applies directly) or provider-`stopped` (the probe's `:221-232` branch does swap the serve — a
wedged serve there is replaced on wake) is decidable only from Vercel-side status/logs, not from
this repo. Part A's branches are reachable regardless of provider status, and Part B guarantees
that any Part-A wedge on a running sandbox is unrecoverable by the client. Both halves are
repo-verified; the join (which half dominated the 99%) needs incident telemetry.

### 2.2 Same mechanism, or deeper problem?

Both, and the deeper problem is the load-bearing one. The recurring wedge is the **same symptom
class** (admission latched closed, serve alive, refusal on every frame) reached through **a new
hole** (the keep-seam blind spot, §2.1 Part B) — but the reason phase 1 could fix five defects and
leave this one standing is structural: **there is no lifecycle, only inference**. "Is this sandbox
wedged?" is answered independently by at least four readers over four different records:

1. The serve itself, over a process-local boolean with five writers (`admission.closed`).
2. The client's probe, over provider status + stamp files (`resume-probe.ts`) — no health read on
   the keep path.
3. The drain gate, over a health-body schema (`serve-drain-client.ts:49-77`) — the only reader
   that can see the wedge, on a path the keep verdict never takes.
4. The API, over `row.state` + the mirrored checkpoint phase — two columns, written by different
   actors, never atomically reconciled (§1.1).

Every phase-1 fix added an inference edge to this graph (sourceRestart classification, wedge
proof, re-arm) rather than a state. The wedge recurs because the system's answer to "what stage is
this sandbox in" is computed fresh at every consumer from signals that were never designed to
compose — and one consumer (the keep path) doesn't even collect the signal that would answer it.

## 3. Design judgment — sound vs ad hoc

_In progress._

## 4. Recommended target design

_In progress._
