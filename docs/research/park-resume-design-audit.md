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

_Wake-path trace in progress (sub-agent); what follows is verified first-hand._

**Client side.** The driver probes before resuming: `probeSandboxForResume`
(`packages/harness/src/cloud/resume-probe.ts:185-311`) **infers** the sandbox's lifecycle stage
from three independent signals — provider status (`:220-237`), stamp files read over an in-sandbox
shell (`SERVE_VERSION_PATH`/`SERVE_PROTOCOL_PATH`, `:239-252`), and a health curl
(`probeRuntimeActivity`, `:100-125`). Its decision enum `ESandboxProbe`
(`:14-20`: missing/kept/replaced/rotation-needed/swapped) is a *decision*, not a lifecycle state.
A stopped provider sandbox is resumed in place and serve swapped (`:230-232`).

**Rotation gate.** Before any swap, `drainServe` (`packages/harness/src/cloud/serve-drain-client.ts:139-180`)
re-reads the rotation receipt off the drive (`hasPreparedReceipt`, `:36-47`) and runs
`requireSafePreparation` (`:101-137`): ready / wedged / legacy. The **wedged** gate
(`wedgeProofOf`, `:68-77`) is the admission latch read from the *outside*: a serve with
`admissionClosed: true` and positively-empty work signals is provably dead weight and gets
replaced without draining (`:147-151`).

**API side.** PR/CI events wake parked sandboxes through `GithubSandboxWakeService`
(`apps/api/src/api/cloud/github/github-sandbox-wake.service.ts`): filters subscriptions to rows
whose **state column** is `Parked` (not the checkpoint phase), conditional `Parked→Resuming`
claim, then `VercelSandboxWakeBoot.boot` deletes the stale sandbox, remounts the drive, and
launches serve fresh (`github-sandbox-wake-boot.ts:55-95`). Note the consequence of §1.1: this
filter reads `row.state`, which a serve-initiated idle park never updates — the wake service can
miss sandboxes that parked themselves.

**Serve side on boot over parked state.** Every boot runs rotation recovery
(`apps/serve/src/serve-rotation-recovery.ts`): reads `operational/sandbox-rotation.json`
(`:27`), classifies `sourceRestart` (`:34`), and — since #1216 — a source restart deletes the
receipt and boots open (`:35-39,71-74`). The boot then publishes a fresh `running` checkpoint
(`serve-boot-finish.ts:219`, gated on `checkpointAllowed` which is now always true), overwriting
the parked one at the next revision.

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

_Section in progress — forensic sub-agent is bisecting the phase-1 → v1.106.3 window.
Preliminary: the phase-1 fixes are intact (verified at HEAD), but they patched inference edges;
the latched-admission branches above were not all closed, and ~8 releases of lifecycle churn
landed on 2026-10-14 alone (#1222–#1250, including #1245's in-place rotation rewrite that deleted
successor-handoff machinery)._

## 3. Design judgment — sound vs ad hoc

_In progress._

## 4. Recommended target design

_In progress._
