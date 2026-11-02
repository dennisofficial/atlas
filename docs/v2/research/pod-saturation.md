# Pod saturation: what #1657 protects serve from, measured

Part of the evidence for [v2](../README.md). Empirical runs inside throwaway Vercel
Sandboxes on 2026-11-02, measuring whether the workload-priority fix from #1657 keeps the
serve loop responsive when a workload saturates the pod, and whether a cgroup process cap
is achievable inside a pod. Raw logs and the driver lived in the
running session's scratch directory and are not kept.

## Method

A Bun **stand-in serve** is uploaded to the sandbox and run with `ATLAS_API_PROVISIONED=1`
so the #1657 gate (`mirrorsThreadState`: provisioned and not a local pod) is on. In **fixed**
mode it applies the real `applyServePriority` (oom_score_adj −900, nice −5 on every thread,
`H/execution/serve-priority.ts`) and spawns workloads through the real `workloadCommand`
wrapper (a `/bin/sh` prelude writing oom_score_adj 800 then `exec nice -n +10`,
`H/execution/workload-priority.ts`). In **baseline** mode the wrapper is skipped and no
serve priority is applied — the pre-#1657 behavior.

The stand-in serves `GET /health` (immediate, with a timestamp), runs a 10 ms ticker
recording event-loop lag, spawns workloads on `POST /spawn`, and kills a workload's process
group (`kill(-pid, SIGKILL)`) on `POST /stop`. The driver (outside the sandbox) polls
`/health` every ~200 ms via `sandbox.runCommand curl`, recording latency and failures. One
fresh sandbox per scenario, 30-minute hard timeout, always stopped in `finally`.

Sandbox shape matches production: `image: atlas-sandbox:latest`, 4 vCPU, 8 GB RAM, `iad1`,
cgroup v2, pid 1 = `sandbox-init`, all commands run as **root** (uid 0). Vercel does not
impose a pids controller cap on the pod cgroup by default (`/sys/fs/cgroup/pids.max` = `max`).

## Findings at a glance

- **#1657 protects serve from CPU saturation and from memory exhaustion.** Under both, the
  fixed serve answered /health with zero failures and sub-second p99, and the OOM killer
  chose the hog, not serve, on every run.
- **#1657 does not protect against an unbounded fork bomb.** With no process cap the pod
  wedges: the kernel pid table fills and even Vercel's own command channel returns
  `fork/exec … resource temporarily unavailable` (EAGAIN). nice/oom_score_adj cannot help —
  the limit is fork, not CPU or memory.
- **A cgroup process cap is achievable as root in a pod and fully contains a fork bomb.** It
  is the only one of these protections that holds against `:(){ :|:& };:`.

## Scenario 1 — CPU saturation

Load: 8 `while :; do :; done` busy loops plus a real-ish `bun test` (200 tests), all spawned
as workloads through the wrapper (fixed) or unwrapped (baseline). /health polled 200 ms.

| | quiet p50/p99/max | under load p50/p99/max | probe failures | loop lag max |
|---|---|---|---|---|
| baseline (pre-#1657) | 65 / 368 / 368 ms | 80 / 190 / 191 ms | 0 / 150 | 8.3 ms |
| fixed (#1657) | 67 / 285 / 341 ms | 68 / 147 / 242 ms | 0 / 150 | 8.4 ms |

The serve survives CPU saturation with and without the fix — a Bun health responder is cheap
enough that even niced-out competition leaves it scheduled. The fix narrows the tail
(p99 190→147 ms, max 191→242 ms mixed) but the difference is small and within noise. The
**real value of #1657 is not CPU** — it is oom_score_adj ordering (scenario 2). Loop lag
stayed single-digit ms both ways.

## Scenario 2 — memory exhaustion

Load: a hog allocating and touching 128 MB/s with no cap until the kernel OOM-kills it. The
hog runs as a workload, so in fixed mode it carries oom_score_adj 800 while the stand-in
serve carries −900.

| | OOM victim | victim oom_score_adj | serve survived | VM survived | /health during hog p50/p99/max |
|---|---|---|---|---|---|
| baseline | the hog (`bun`, pid 1682) | 500 (default) | yes | yes | 61 / 327 / 622 ms, 0/592 failed |
| fixed | the hog (`bun`, pid 1681) | **800 (set by wrapper)** | yes | yes | 63 / 272 / 515 ms, 0/594 failed |

dmesg confirms the kill and the score the kernel used:
`Out of memory: Killed process 1681 (bun) anon-rss:8340992kB oom_score_adj:800` (fixed) and
the same line with `oom_score_adj:500` (baseline). The serve's `oom_score_adj −900` was
verified live in `/proc/<pid>/oom_score_adj`. There was no no-swap thrash window — the pod
has 0 swap, so the OOM killer fired within a second of the hog reaching ~8.3 GB anon RSS;
/health never stalled. In both modes the hog died and the serve and VM lived. #1657 makes
the victim *deterministic* (the hog is always the highest-scored large process) rather than
leaving it to RSS alone; with only default scores the killer could equally pick serve's Bun
process under a different allocation mix. The wrapper's `echo 800 > /proc/self/oom_score_adj`
in the fork/exec prelude works exactly as designed — measured, not assumed.

## Scenario 3 — fork bombs

### Bounded: 5,000 sleeping children (fixed)

Spawned `sh -c 'i=0; while [ $i -lt 5000 ]; do sleep 600 & i=$((i+1)); done; wait'` as a
workload. Process count peaked at 5,006. /health: 66/151/220 ms, 0/75 failed, loop lag
3.5 ms — the pod tolerates 5k idle processes fine. **Correction (2026-11-02): the /stop
failure below is a stand-in artifact, not an Atlas bug.** The stand-in spawned workloads without
`detached: true`, so they never led their own process group. Atlas's `LocalProcessPort` spawns
with `detached: true` (setsid), and `exec` keeps the pid through the wrapper, so the spawned pid
stays the group leader. Re-checked against the real `LocalProcessPort` with the #1657 wrapper on:
ten background children of a wrapped `sh` were all gone after `terminate()`. The stand-in's
original observation, kept for the record:
`kill(-pid)` returned `ESRCH` (1 ms). The workload's intermediate `/bin/sh -c prelude`
exec'd `nice`, and by the time /stop ran the direct child was the *sleep parent*, not the
process-group leader the wrapper pid referred to; the whole group had reparented. The 5,000
children outlived every kill attempt and had to be swept with `pkill -KILL -f 'sleep 600'`.
A process-group kill keyed on the spawned pid is unreliable once the wrapper execs — the pid
recorded is the wrapper's, and the group's leadership moves.

### Unbounded: `:(){ :|:& };:` (fixed)

The bomb **wedged the pod**. /health stayed up briefly (160/162 ok, p99 172 ms) because the
nice −5 serve kept scheduling, but the kernel pid table filled and the sandbox became
unmanageable: the very next `runCommand` from the SDK failed with
`failed to start process: fork/exec /usr/bin/sh: resource temporarily unavailable` (EAGAIN).
/health could not be re-probed, /stop could not be reached (the workload had already exited,
pid unknown), and there is no in-pod recovery — the VM must be destroyed. This is the case
#1657 cannot fix: fork is gated by the pid count, not by CPU or memory, so nice and
oom_score_adj are irrelevant once the table is full.

## Scenario 4 — cgroup isolation probe

As root, on the pod's cgroup v2 root (`/sys/fs/cgroup`, `cgroup2fs`, controllers
`cpuset cpu io memory hugetlb pids`, pid 1 `sandbox-init`):

| step | result |
|---|---|
| `mkdir atlas-serve atlas-work` | OK |
| move all root procs (incl. pid 1) out of root into `atlas-serve` | OK (one EOPNOTSUPP on a transient pid; ~6 moved) |
| `echo "+cpu +pids" > cgroup.subtree_control` | OK — only after the root is emptied (no-internal-process constraint) |
| `echo 2048 > atlas-work/pids.max` | OK |
| `echo 20 > atlas-work/cpu.weight`; `echo 500 > atlas-serve/cpu.weight` | OK |
| move stand-in serve into `atlas-serve` | OK |

Then a fork bomb was launched **inside** `atlas-work` (pids.max 2048, cpu.weight 20) while
the serve ran in `atlas-serve` (cpu.weight 500):

| | /health under capped bomb | probe failures | loop lag max | VM |
|---|---|---|---|---|
| capped | 63 / 315 / 380 ms | 0 / 147 | 1.8 ms | survived, stayed manageable |

The cap held: `atlas-work/pids.current` was clamped at 2048 and `pids.events` recorded the
limit being hit. The serve never noticed. Contrast with scenario 3 uncapped: same bomb, VM
wedged to EAGAIN. **A process cap via cgroups is achievable in a Vercel pod, with the exact
sequence: empty the root cgroup → enable `+cpu +pids` in `subtree_control` → mkdir the two
children → set `pids.max` / `cpu.weight` → move serve into the high-weight child and spawn
workloads into the capped child.**

## What is still unknown

- **20,000-child bounded fork** was not run (the 5k case already showed the group-kill
  problem; 20k would only re-measure pid-table headroom, not serve protection).
- Whether a cgroup restructure at sandbox boot is safe to automate: moving pid 1 and the
  Vercel `sandbox-init` machinery into a child cgroup at runtime worked, but doing it on
  every boot before serve starts, and how it interacts with sandbox snapshot/resume, is
  untested.
- The `atlas-sandbox` image has `ulimit -u` unset, so a cheaper partial mitigation — a
  per-process `ulimit -u` in the workload prelude — is untested and would only cap per-user
  processes, not the pod-wide table.
- A workload that calls `setsid` itself escapes the group kill; only a cgroup (kill every
  pid in `atlas-work`, or `cgroup.kill`) catches it.
- Whether `+memory` can be enabled once the root is emptied. The earlier probe failed with the
  root still holding processes, the same no-internal-process constraint that blocked
  `+cpu +pids`; if it works, `atlas-work/memory.max` replaces the harness memory watchdog.
- The real atlas-serve under load. The stand-in is a trivial responder; real serve does
  whole-log work on every append and pull ([log-scale](log-scale.md)), so it competes for CPU
  far more than the stand-in and gains more from nice than scenario 1 shows.
