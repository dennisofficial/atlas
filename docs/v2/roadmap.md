# Atlas v2 roadmap

Ordered slices, the current state, and how the work moves between sessions. The design is in
[architecture.md](architecture.md); the package map is [0019](../decisions/0019-v2-package-map.md).

## How v2 is built: one slice per session

Each slice is built in its own Atlas session and handed to a fresh session when it is done.
1. **Start.** Read [README.md](README.md), then this file's [Current state](#current-state), then
   the slice's spec in [slices/](slices/). If the spec does not exist, writing it is the first job,
   and the operator approves it before building starts.
2. **Build.** One branch and one or more PRs per slice. Every PR merges to `main` with v1 still
   working, because v1 is the daily driver. A slice that touches v1 code (an extraction) changes
   no v1 behaviour.
3. **Verify.** The slice's exit criterion holds, CI is green, and the operator restarts and tests
   v1 after the merge.
4. **Update the docs in the same PR as the code.** Mark the slice done below, write what the next
   session must know under Current state, and fix any doc the code proved wrong. `docs/v2` is the
   only handover that survives: cloud session scratch and `/tmp` do not.
5. **Hand off.** Run the handoff skill. The handoff doc points at these files; it does not repeat
   them.

## Current state

_Updated at the end of every slice. Last update: 2026-11-04._
- **Done:** slice 0 (design). Decision 0018 accepted, 0019 (package map) proposed; D6 storage verified (Prisma 8
  `namespace v2`); research censuses refreshed to `a0bf4110`.
- **Done:** slice 1, record core ([spec](slices/01-record-core.md)). Pure rules in
  `packages/core/src/record/`; `@dltech/atlas-control` (`ControlPlane` over one
  `ControlStorePort.transact`, in-memory and Postgres adapters, one conformance suite); the
  Postgres `v2` schema (migration `20261102T0507_v2_record_core`). The scale check
  (`ATLAS_SCALE_TESTS=1`, 20k events) is flat: 50-event append ≈8 ms, 500-event ranged read
  ≈18 ms at both ends, index scan on `(threadId, seq)`.
- **Done:** slice 2, the `agent` package ([spec](slices/02-agent.md); PRs #1696, #1702 and the exit PR).
  `packages/agent` holds the loop, intake, retries and dispatcher; `harness` re-exports it. Prompt
  fragment groups replaced `ctx.agent`; `./testing` ships in-memory record, intake, scripted model and
  fake tools; six exit tests run the loop with no pod, lease or filesystem. v1 unchanged.
  Follow-up PR: supersede a thinking-only request (spec section), behind a setting.
- **Decided 2026-11-02: D8, [0021](../decisions/0021-v2-loop-runs-on-the-agent-host.md).** The agent
  loop runs on a long-lived agent host (Render, Virginia; a separate `apps/agent-host` service
  in the Comp AI Render workspace, confirmed by the operator); sandboxes stay on Vercel Sandbox and
  only execute, through a small in-sandbox daemon over one persistent WebSocket (measured
  3.6-6.5 ms p50 per call).
- **Decided 2026-11-02: [0022](../decisions/0022-v2-background-jobs-in-apps-trigger.md).** v2 background
  jobs and schedules run on trigger.dev in their own `apps/trigger` (own deploy, keys and trigger.dev
  project; contracts in `packages/jobs`), never as timers in the agent host. Built when v2 first needs
  a job, after the reconciler. v1's `apps/api/src/trigger/` takes fixes only and retires at slice 10.
- **Done (exit tests partly live): slice 3, the agent host and the sandbox daemon (0021).** Spec:
  [slices/03-agent-host.md](slices/03-agent-host.md); PRs #1735 to #1846. Render Virginia → Vercel `iad1`
  RTT was measured first ([research/d8/rtt-render.md](research/d8/rtt-render.md): 5–20 ms p50 per tool
  call, Postgres 5.5 ms). The toggle is per session with a `v2` badge. What it delivered:
  - A runnable agent host (`apps/agent-host`, Render) and sandbox daemon (`apps/daemon`); the lease
    holder runs the loop, appends hash-chained events to Postgres and survives a restart: retry
    deadlines, hook decisions and tool results are recorded, so a new holder resumes the turn.
  - A fault rig and the fault rows F1–F21 against real processes; rows that cannot fit in about 20 s
    run when `ATLAS_FAULT_TESTS=1`, which the nightly sets.
  - Large payloads: tool inputs and outputs spill to content-addressed blobs in the append
    transaction; the API pages events under a byte budget and returns an oversized single event as a
    marker; branch observation from the sandbox's git refs is logged as `branches-observed`.
  - A new session is prepared (clone, setup script) before its first turn, and a failed setup is a
    status with a reason (`setup-failed`), not a log line.
  - Wakes are Postgres `LISTEN`/`NOTIFY`, and the host has no polling timers; an idle session stays
    parked across an agent-host deploy.
  - **Live numbers (2026-11-04, production, the atlas repo).** New session: create to workspace
    prepared 26 s (sandbox and daemon about 6 s, clone and `bun install` about 20 s). Then a warm
    wake: the first message reached `user-said` in 66 ms, a bash call took 65 ms, and the reply came
    3.4 s after posting. Before prepare-before-first-turn, a cold first turn took 3438 ms to
    `user-said` and 19.9 s in total. Parked wake: `TBD (measuring)`. The first parked measurement,
    9.0 s, exposed a turn that waited for the sandbox (#1841); it is fixed and not yet re-measured.
  - **Left:** the live exit tests 8 (append p99), 9 (hog) and 10 (20k events), and the starred fault
    rows on Render. F9 is now "Redis down: unaffected", since no wake path uses Redis. Continue from
    [handoffs/slice-4.md](handoffs/slice-4.md).
- **Decided 2026-11-04, slice 3:** wakes move from Redis pub/sub to Postgres `LISTEN`/`NOTIFY`
  ([0021](../decisions/0021-v2-loop-runs-on-the-agent-host.md) amended); the agent host polls nothing,
  and one reactive reconcile loop per held session replaces the inbox, stop and idle polls; a session is
  prepared before its first turn; v1 and v2 share no logic: v1 has its own copy of the loop
  (`packages/agent-v1`), `packages/agent` is v2-only, a lint guard (`scripts/check-package-split.ts`)
  rejects imports across the split, and v1 is deleted at cutover.
- **Slice 3 spec settled (2026-11-02 and 2026-11-03), in [slices/03-agent-host.md](slices/03-agent-host.md):**
  oversize single events against the 4 MB body cap (point 12); the per-session `engine: v2` flag and
  who sees it (point 9); v1's API stays the only writer of users, projects, credentials and settings
  until cutover (point 2); the sandbox disk is one session, threads keep a subdirectory (point 7); branch
  and PR tracking from the git refs of the sandbox's clones, with the session view every local branch
  except the default (point 11); appends to the CP within ~1 s (point 4, measured by exit test 8, still
  to run live); the agent-host service shape and the `pod` package rename (point 1); the RTT measurement
  first (Measurements).
  Carried forward:
  **Slice 5 exit gains:** opening a session active a moment ago shows its latest event within ~1 s,
  cold and warm cache (clients open from the CP tail plus a cache keyed by (epoch, seq), then follow
  the stream; the agent host is never on the open path). **Slice 9:** local sandboxes clone, never bind-mount
  the operator's checkout.
- **Design added 2026-11-03, read before specifying slices 3 and 6:**
  [slices/summarise-at-message.md](slices/summarise-at-message.md) (summarise up to a
  message as an inbox command; decided 2026-11-03: prefix only, a rewind may undo a summary, and a
  refused inbox command appends `input-refused{inboxId, reason}`).
- **Scale target:** ~20k events per thread, from production data (architecture §12). Earlier 1M
  figures were a hypothetical stress size; whole-log work is removed only where that is trivial.
- **Open:** browsing the files of a parked sandbox (a workspace mirror kept by the control plane) is
  proposed, not scheduled. D2 (local control plane), needed only at slice 9. 0020 (sub-agent worktrees, peer
  sessions) proposed; teammates survive as the peer-session preset — placement, ownership and
  conversation separated, the operator owning and archiving — settled in
  [slices/03-teammates.md](slices/03-teammates.md) (a design section, not a build slice).
- **Needs triage:** credential availability (truthful waiting for a dead or exhausted model
  account, operator recheck/pause, explicit recovery). v1 slices 1–4A are merged and 4B is built
  but unmerged; whether v2 adopts that design or rebuilds it is undecided. See
  [research/credential-availability/](research/credential-availability/README.md).
- **v1 fixes found while doing v2** (shipped separately): #1649 append-fork reconcile; #1651
  fault-killed sub-agents end once; #1653 sub-agent session-index race (a sibling's mirror write
  could put a sub-agent in an empty session); #1657 keeps atlas-serve out of the OOM killer's path and
  ahead of workloads on CPU (the v1 half of architecture §11; measured in
  [pod-saturation](research/pod-saturation.md)). The fork bomb, which wedged a pod, is fixed by
  the `atlas-serve` / `atlas-work` cgroup split with `pids.max` and a box per workload (§11 R2;
  shipped in #1684).
  Measured since: `+memory` also delegates once the root is empty (`memory.max` contains a hog),
  `cgroup.kill` catches setsid escapees, and the split does not survive snapshot/resume, so it must
  be applied on every boot ([pod-saturation](research/pod-saturation.md) scenario 5).
- **Design added 2026-11-02, read before specifying slices 3, 4, 6 and 7:** architecture §14
  (archive is read-only and enforced by the CP; archived sandboxes are deleted after 7 days with no
  unsaved-work guard; auto-archive after 72 h idle, pinned exempt; sandbox idle stop 5–10 min,
  measured in slice 3). v1 gets the 7-day deletion now as a daily sweep.
- **Design added 2026-11-02, read before specifying slices 1, 3, 4 and 5:** architecture §12 (a
  long thread, ~20k events, runs smoothly: ranged reads only, materialized current state, artifacts out of line,
  tail-first clients; evidence [log-scale](research/log-scale.md)) and §13 (the lease is liveness;
  one reconciler per session; the Kubernetes patterns v2 follows).

## Slices

| #   | Slice                                 | Goal                                                                                                                                                                                                                                                                                                        | Exit criterion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | State                    |
| --- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 0   | Design and records                    | Lock the decisions; write the design docs                                                                                                                                                                                                                                                                   | 0018, 0019 and these docs merged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Done                     |
| 1   | Record core                           | Pure log/inbox/lease/history rules in `core`; the `control` package with a Postgres adapter over `namespace v2`                                                                                                                                                                                             | Property tests pass for the seq-466 interleaving, stale-epoch writes, hash mismatch and append-only rewind; the v2 schema migrates cleanly beside v1                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Done                     |
| 2   | `agent` package                       | Extract the loop (turn runner, retries, intake, tool dispatch, model port) from `harness` into `packages/agent`; v1 imports it                                                                                                                                                                              | `harness` re-exports or imports `agent`; no v1 behaviour change; the loop runs in a test with no pod, lease or filesystem store                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Done                     |
| 2b  | Tracing ([spec](slices/02b-trace.md)) | `TracePort` in `observability`, PostHog export, spans on the loop's model calls, tools, hooks, intake and record                                                                                                                                                                                            | A scripted turn yields a nested span tree; spans reach PostHog with names, ids and counts only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Done                     |
| 3   | Agent host + sandbox daemon (cloud)   | The agent host holds the lease, runs `agent`, appends hash-chained events to the CP, consumes the inbox; the sandbox daemon executes (exec, files, grep, shells, services, MCP, terminal) over one persistent WebSocket; v2 agent host ⇄ CP and agent host ⇄ daemon schemas in `protocol`; v2 API namespace | The Render Virginia → Vercel `iad1` RTT is measured (0021); a scripted multi-turn session with tools runs through the daemon; killing an agent host mid-model-stream and mid-tool hands the turn to another agent host, which finishes it with no tool run twice; an agent host killed mid-bash leaves the call running and the next holder collects its result; a hook decision and a retry backoff survive a restart; a second writer at the same seq is rejected; append latency stays ~1 s; under a CPU and memory hog the lease never lapses, stop lands, and the watchdog kills the hog, not the daemon (architecture §11) | In progress (exit tests) |
| 4   | Views                                 | Status, the context meter (`contextMeterOf` in `core/src/record/context-meter.ts`, already written), the session's checkout set (every thread's branch and worktree, 0020), PR links and subscriptions summary are folds in `core`, materialized by the CP at a log position                                | Every field v1 clients derive by heuristic is a view or shown as unknown; the incident's branch and PR link appear from the log alone                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Not started              |
| 5   | Client SDK, web and Mac               | `packages/client` session stream, view cache and inbox commands; web and Mac open v2 sessions behind the `engine: v2` flag                                                                                                                                                                                  | **First milestone:** a real cloud session on v2 from the web, with basic chat and tools, resumable after the stream drops and after a park                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Not started              |
| 6   | `plugin-sdk` and `commands`           | The type-level event registry and plugin contract; the `commands` package and the `commands/` root with the native commands as inbox commands rendered on web and TUI                                                                                                                                       | A command defined once runs from web and TUI; a plugin's events are exhaustively typed without editing `core`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Not started              |
| 7   | Plugins, one at a time                | Move crew (sub-agents carry the worktree tools but never subscribe), shells and services, subscriptions and GitHub, memory, previews into `plugins/`; add sessions (`spawn_session`, `message_session`, `list_sessions`) in place of nested teammates (0020). One spec each                                 | Each plugin runs on v2 with all its slots registered; no plugin imports another                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Not started              |
| 8   | Hardening and daily use               | Use v2 for the maintainer's own cloud work and close the gaps                                                                                                                                                                                                                                               | A defined period of daily work on v2 with no manual repair of a session                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Not started              |
| 9   | Local                                 | A docker pod against a control plane; then `atlasd` (D2) over SQLite; then the TUI on v2                                                                                                                                                                                                                    | A local session runs on v2 from Mac and the TUI, offline, in exactly one control plane                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Not started              |
| 10  | v1 retirement                         | Remove v1 once v2 has proven itself                                                                                                                                                                                                                                                                         | The maintainer decides; cutover moves everything to v2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Not started              |

Notes:
- Slices 1 and 2 are independent and may swap order; slice 3 needs both.
- Slice 7 is one spec and usually one session per plugin.
- The exit criteria are the bar for calling a slice done; a spec may add stricter ones.
