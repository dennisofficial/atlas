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
- **Next:** slice 1, record core. Its spec is drafted at
  [slices/01-record-core.md](slices/01-record-core.md) and needs the operator's approval before
  building starts.
- **Open:** D2 (local control plane), needed only at slice 9. 0020 (sub-agent worktrees, peer
  sessions) proposed; whether teammates survive as a preset or a toggle is decided in the sessions
  plugin spec.
- **Needs triage:** credential availability (truthful waiting for a dead or exhausted model
  account, operator recheck/pause, explicit recovery). v1 slices 1–4A are merged and 4B is built
  but unmerged; whether v2 adopts that design or rebuilds it is undecided. See
  [research/credential-availability/](research/credential-availability/README.md).
- **v1 fixes found while doing v2** (shipped separately): #1649 append-fork reconcile; #1651
  fault-killed sub-agents end once; #1653 sub-agent session-index race (a sibling's mirror write
  could put a sub-agent in an empty session); #1657 keeps atlas-serve out of the OOM killer's path and
  ahead of workloads on CPU (the v1 half of architecture §11; measured in
  [pod-saturation](research/pod-saturation.md)). Still open in v1: the fork bomb, which wedges a
  pod; the measured fix is the `atlas-serve` / `atlas-work` cgroup split with `pids.max` (§11 R2).
- **Design added 2026-11-02, read before specifying slices 1, 3, 4 and 5:** architecture §12 (a
  thread runs at 1M events: ranged reads only, materialized current state, artifacts out of line,
  tail-first clients; evidence [log-scale](research/log-scale.md)) and §13 (the lease is liveness;
  one reconciler per session; the Kubernetes patterns v2 follows). Slice 1's spec took five scale
  corrections from the operator in its own session; reconcile it with §12.

## Slices

| #   | Slice                       | Goal                                                                                                                                                                                                                                                           | Exit criterion                                                                                                                                                                                                                                       | State        |
| --- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 0   | Design and records          | Lock the decisions; write the design docs                                                                                                                                                                                                                      | 0018, 0019 and these docs merged                                                                                                                                                                                                                     | Done         |
| 1   | Record core                 | Pure log/inbox/lease/history rules in `core`; the `control` package with a Postgres adapter over `namespace v2`                                                                                                                                                | Property tests pass for the seq-466 interleaving, stale-epoch writes, hash mismatch and append-only rewind; the v2 schema migrates cleanly beside v1                                                                                                 | Spec drafted |
| 2   | `agent` package             | Extract the loop (turn runner, retries, intake, tool dispatch, model port) from `harness` into `packages/agent`; v1 imports it                                                                                                                                 | `harness` re-exports or imports `agent`; no v1 behaviour change; the loop runs in a test with no pod, lease or filesystem store                                                                                                                      | Not started  |
| 3   | Pod host (cloud)            | `packages/pod` holds a lease, runs `agent` against the record ports, appends hash-chained events, consumes the inbox; v2 pod ⇄ CP schemas in `protocol`; v2 API namespace                                                                                      | A cloud pod on v2 completes a scripted multi-turn session with tools; a second writer at the same seq is rejected; under a CPU and memory hog the lease never lapses, stop lands, and the watchdog kills the hog, not the harness (architecture §11) | Not started  |
| 4   | Views                       | Status, the session's checkout set (every thread's branch and worktree, 0020), PR links and subscriptions summary are folds in `core`, materialized by the CP at a log position                                                                                | Every field v1 clients derive by heuristic is a view or shown as unknown; the incident's branch and PR link appear from the log alone                                                                                                                | Not started  |
| 5   | Client SDK, web and Mac     | `packages/client` session stream, view cache and inbox commands; web and Mac open v2 sessions behind the `engine: v2` flag                                                                                                                                     | **First milestone:** a real cloud session on v2 from the web, with basic chat and tools, resumable after the stream drops and after a park                                                                                                           | Not started  |
| 6   | `plugin-sdk` and `commands` | The type-level event registry and plugin contract; the `commands` package and the `commands/` root with the native commands as inbox commands rendered on web and TUI                                                                                          | A command defined once runs from web and TUI; a plugin's events are exhaustively typed without editing `core`                                                                                                                                        | Not started  |
| 7   | Plugins, one at a time      | Move crew (sub-agents, with worktrees pinned at spawn), shells and services, subscriptions and GitHub, memory, previews into `plugins/`; add sessions (`spawn_session`, `message_session`, `list_sessions`) in place of nested teammates (0020). One spec each | Each plugin runs on v2 with all its slots registered; no plugin imports another                                                                                                                                                                      | Not started  |
| 8   | Hardening and daily use     | Use v2 for the maintainer's own cloud work and close the gaps                                                                                                                                                                                                  | A defined period of daily work on v2 with no manual repair of a session                                                                                                                                                                              | Not started  |
| 9   | Local                       | A docker pod against a control plane; then `atlasd` (D2) over SQLite; then the TUI on v2                                                                                                                                                                       | A local session runs on v2 from Mac and the TUI, offline, in exactly one control plane                                                                                                                                                               | Not started  |
| 10  | v1 retirement               | Remove v1 once v2 has proven itself                                                                                                                                                                                                                            | The maintainer decides; cutover moves everything to v2                                                                                                                                                                                               | Not started  |

Notes:
- Slices 1 and 2 are independent and may swap order; slice 3 needs both.
- Slice 7 is one spec and usually one session per plugin.
- The exit criteria are the bar for calling a slice done; a spec may add stricter ones.
