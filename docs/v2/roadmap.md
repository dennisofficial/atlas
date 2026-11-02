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

_Updated at the end of every slice. Last update: 2026-11-02._
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
- **Decided 2026-11-02: D8, [0021](../decisions/0021-v2-loop-runs-on-control-plane-workers.md).** The agent
  loop runs on long-lived control-plane workers (Render, Virginia; a separate `apps/worker` service
  in the Comp AI Render workspace, confirmed by the operator); sandboxes stay on Vercel Sandbox and
  only execute, through a small in-sandbox daemon over one persistent WebSocket (measured
  3.6-6.5 ms p50 per call).
- **Next: slice 3, the worker host and the sandbox daemon (0021).**
- **Slice 3 spec must settle:** oversize single events against the 4 MB body cap (L5), the `engine: v2`
  session flag and who sees it, and that v1's API stays the only writer of users, projects,
  credentials and settings until cutover; the sandbox disk is one session (sandboxes are 1:1 with sessions, no
  `sessions/<id>/` level; threads keep their own subdirectory); branch and PR tracking reads the git
  refs of the sandbox's own clones (`refs/heads` plus the worktree list), logged as events, and the
  session view is every local branch except the default (slices 3, 4 and the github plugin); the worker
  appends to the CP within ~1 s in small batches (exit check: append latency); the worker-service
  shape and the `pod` package rename (0021); the Render Virginia → Vercel `iad1` RTT measurement
  comes first (0021).
  **Slice 5 exit gains:** opening a session active a moment ago shows its latest event within ~1 s,
  cold and warm cache (clients open from the CP tail plus a cache keyed by (epoch, seq), then follow
  the stream; the worker is never on the open path). **Slice 9:** local sandboxes clone, never bind-mount
  the operator's checkout.
- **Scale target:** ~20k events per thread, from production data (architecture §12). Earlier 1M
  figures were a hypothetical stress size; whole-log work is removed only where that is trivial.
- **Open:** D2 (local control plane), needed only at slice 9. 0020 (sub-agent worktrees, peer
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
- **Design added 2026-11-02, read before specifying slices 1, 3, 4 and 5:** architecture §12 (a
  long thread, ~20k events, runs smoothly: ranged reads only, materialized current state, artifacts out of line,
  tail-first clients; evidence [log-scale](research/log-scale.md)) and §13 (the lease is liveness;
  one reconciler per session; the Kubernetes patterns v2 follows).

## Slices

| #   | Slice                                | Goal                                                                                                                                                                                                                                                                                                 | Exit criterion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | State       |
| --- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| 0   | Design and records                   | Lock the decisions; write the design docs                                                                                                                                                                                                                                                            | 0018, 0019 and these docs merged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Done        |
| 1   | Record core                          | Pure log/inbox/lease/history rules in `core`; the `control` package with a Postgres adapter over `namespace v2`                                                                                                                                                                                      | Property tests pass for the seq-466 interleaving, stale-epoch writes, hash mismatch and append-only rewind; the v2 schema migrates cleanly beside v1                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Done        |
| 2   | `agent` package                      | Extract the loop (turn runner, retries, intake, tool dispatch, model port) from `harness` into `packages/agent`; v1 imports it                                                                                                                                                                       | `harness` re-exports or imports `agent`; no v1 behaviour change; the loop runs in a test with no pod, lease or filesystem store                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Done        |
| 3   | Worker host + sandbox daemon (cloud) | The worker host holds the lease, runs `agent`, appends hash-chained events to the CP, consumes the inbox; the sandbox daemon executes (exec, files, grep, shells, services, MCP, terminal) over one persistent WebSocket; v2 worker ⇄ CP and worker ⇄ daemon schemas in `protocol`; v2 API namespace | The Render Virginia → Vercel `iad1` RTT is measured (0021); a scripted multi-turn session with tools runs through the daemon; killing a worker mid-model-stream and mid-tool hands the turn to another worker, which finishes it with no tool run twice; a worker killed mid-bash leaves the call running and the next holder collects its result; a hook decision and a retry backoff survive a restart; a second writer at the same seq is rejected; append latency stays ~1 s; under a CPU and memory hog the lease never lapses, stop lands, and the watchdog kills the hog, not the daemon (architecture §11) | Not started |
| 4   | Views                                | Status, the session's checkout set (every thread's branch and worktree, 0020), PR links and subscriptions summary are folds in `core`, materialized by the CP at a log position                                                                                                                      | Every field v1 clients derive by heuristic is a view or shown as unknown; the incident's branch and PR link appear from the log alone                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Not started |
| 5   | Client SDK, web and Mac              | `packages/client` session stream, view cache and inbox commands; web and Mac open v2 sessions behind the `engine: v2` flag                                                                                                                                                                           | **First milestone:** a real cloud session on v2 from the web, with basic chat and tools, resumable after the stream drops and after a park                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Not started |
| 6   | `plugin-sdk` and `commands`          | The type-level event registry and plugin contract; the `commands` package and the `commands/` root with the native commands as inbox commands rendered on web and TUI                                                                                                                                | A command defined once runs from web and TUI; a plugin's events are exhaustively typed without editing `core`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Not started |
| 7   | Plugins, one at a time               | Move crew (sub-agents carry the worktree tools but never subscribe), shells and services, subscriptions and GitHub, memory, previews into `plugins/`; add sessions (`spawn_session`, `message_session`, `list_sessions`) in place of nested teammates (0020). One spec each                          | Each plugin runs on v2 with all its slots registered; no plugin imports another                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Not started |
| 8   | Hardening and daily use              | Use v2 for the maintainer's own cloud work and close the gaps                                                                                                                                                                                                                                        | A defined period of daily work on v2 with no manual repair of a session                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Not started |
| 9   | Local                                | A docker pod against a control plane; then `atlasd` (D2) over SQLite; then the TUI on v2                                                                                                                                                                                                             | A local session runs on v2 from Mac and the TUI, offline, in exactly one control plane                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Not started |
| 10  | v1 retirement                        | Remove v1 once v2 has proven itself                                                                                                                                                                                                                                                                  | The maintainer decides; cutover moves everything to v2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Not started |

Notes:
- Slices 1 and 2 are independent and may swap order; slice 3 needs both.
- Slice 7 is one spec and usually one session per plugin.
- The exit criteria are the bar for calling a slice done; a spec may add stricter ones.
