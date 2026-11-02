# Atlas v2

**Goal.** Redesign Atlas so every piece of state has one writer and the same architecture runs
local and in the cloud: client ⇄ control plane ⇄ pod. The business logic (loop, tools, providers,
assembly, compaction, prompts, hooks, skills, sub-agents) carries over; who owns what changes.

**Status: design done, nothing built yet.** Decisions
[0018](../decisions/0018-v2-pod-first-architecture.md) and
[0019](../decisions/0019-v2-package-map.md) (proposed) are the design, except D2 (the local control plane),
which is still open. Each slice in the [roadmap](roadmap.md) gets a spec in [slices/](slices/)
before it is built.

**Start here (every new session):** read this file, then [roadmap.md](roadmap.md) (its _Current
state_ says what to do next and how slices move between sessions), then the next slice's spec.
Read [architecture.md](architecture.md) for the design. The research files are the evidence it
rests on.

## Why v2 exists

v1 was born as one process, and pods were adapted onto it. Facts that used to have one home now
have two or three, joined by best-effort replication with no ownership rules. On 2026-11-01 a
cloud session lost about 560 events of visible state to a sequence-number fork between the API and
the pod ([incident](research/incident-2026-11-01-seq466.md)). Patching each seam keeps the fork;
v2 changes who owns what.

## How v1 and v2 coexist

- v1 keeps working throughout. Atlas is the maintainer's daily driver, which today means
  atlas-web and atlas-mac with cloud sessions. Nothing in v1 is removed before v2 has proven itself
  on real work.
- v2 is a session kind (`engine: v2`), chosen at creation behind a flag. v1 sessions run v1 code
  until they end. Nothing migrates; v2 sessions start empty.
- v2 storage is separate from v1 (a Postgres `v2` schema, or `V2`-prefixed models) and v2 endpoints
  live under their own namespace. No table has both a v1 writer and a v2 writer. At cutover,
  everything goes v2.
- Business logic that v2 shares with v1 is extracted into runtime-agnostic packages as each feature
  moves, and v1 imports the extracted code too. There is one copy of the logic.
- The v1 stopgap for the incident shipped as #1649: the pod reconciles an append fork instead of
  wedging its event flush. It applies the v2 rule (the holder pod is the only seq allocator; input
  the API took is re-delivered through the pod) to v1 without a redesign. It is not part of v2 and
  is deleted with v1.

## Contents

| File                                                                                             | What it is                                                                                                               |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| [architecture.md](architecture.md)                                                               | The authoritative v2 design: principles P1–P8, tiers, protocol, state ownership, package shape, side-by-side plan, risks |
| [roadmap.md](roadmap.md)                                                                         | Current state, the session-per-slice workflow, and the ordered slices with exit criteria                                 |
| [slices/](slices/)                                                                               | One spec per slice, written and approved before the slice is built                                                       |
| [../decisions/0019-v2-package-map.md](../decisions/0019-v2-package-map.md)                       | The package map: foundations in `packages/`, plugins in `plugins/`, native commands in `commands/`                       |
| [../decisions/0018-v2-pod-first-architecture.md](../decisions/0018-v2-pod-first-architecture.md) | The decision record for the locked decisions                                                                             |
| [research/incident-2026-11-01-seq466.md](research/incident-2026-11-01-seq466.md)                 | The incident that triggered the redesign                                                                                 |
| [research/pod-side-state.md](research/pod-side-state.md)                                         | Census of pod-side state: seq allocators, store families, ownership seams                                                |
| [research/control-plane-state.md](research/control-plane-state.md)                               | Census of control-plane (API, Postgres, Redis) and client state                                                          |
| [research/wire-surface.md](research/wire-surface.md)                                             | Census of the wire: protocols, procedures, duplicated paths                                                              |
| [research/pod-saturation.md](research/pod-saturation.md)                                         | Measured: CPU, memory and fork-bomb saturation in a Vercel pod, before and after #1657, and the cgroup process cap       |

The censuses are static reads of the repository at commit `a0bf4110`, not live captures. Their
`file:line` anchors may have moved on `main`; re-check an anchor before relying on it.

## Decisions at a glance

|     | Decision                                                                                 | State                 |
| --- | ---------------------------------------------------------------------------------------- | --------------------- |
| D1  | The durable record lives in the control plane; the holder pod is the only writer of seqs | Locked                |
| D2  | Local control plane: a daemon (`atlasd`) running the same `control` library over SQLite  | **Open**, recommended |
| D3  | The log is append-only; history edits are appended events                                | Locked                |
| D4  | Every durable input goes through the control-plane inbox                                 | Locked                |
| D5  | Foundation packages plus plugins with a fixed shape (package map: 0019)                  | Locked                |
| D6  | v2 storage and endpoints are separate from v1 (Prisma 8 `namespace v2`, verified)        | Locked                |
| D7  | First target: web/mac with a cloud pod                                                   | Locked                |
