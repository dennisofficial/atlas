# Atlas docs

**Start here:** [architecture.md](architecture.md) is the architecture, one design for clients, the
control plane and pods. Then [roadmap.md](roadmap.md), whose _Current state_ says what to work on
next, then the spec for the next slice in [slices/](slices/). The glossary every file uses is
[../CONTEXT.md](../CONTEXT.md).

**What this architecture replaced.** The repository used to run two systems side by side: a v1 cloud
sandbox running its own agent host, and the pod-first design this directory described. v1 was born as
one process, and pods were adapted onto it, so state that used to have one home got two or three,
joined by best-effort replication with no ownership rules. On 2026-11-01 a cloud session lost about
560 events of visible state to a sequence-number fork between the API and the pod
([incident](research/incident-2026-11-01-seq466.md)). The rewrite changed who owns what and kept the
business logic; the v1 code is deleted, and its rows are frozen in the `v1_archive` schema
([data/v1-archive.md](data/v1-archive.md)). The retirement itself is
[slices/v1-retirement.md](slices/v1-retirement.md).

## Contents

| File                                                                            | What it is                                                                                                                                              |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [architecture.md](architecture.md)                                              | The architecture: principles P1–P8, tiers, pod boundary, protocol, state ownership, package shape, pod resources, log scale, liveness, archive, risks   |
| [roadmap.md](roadmap.md)                                                        | Current state, the one-slice-per-run workflow, and the ordered slices with exit criteria                                                                |
| [core-contract.md](core-contract.md)                                            | The loop's seam contract: event log, decode boundary, assembly, hooks, exchange faults                                                                  |
| [slices/](slices/)                                                              | One spec per slice, written and approved before the slice is built; [slices/03-teammates.md](slices/03-teammates.md) is a design section, not a slice   |
| [decisions/](decisions/)                                                        | Decision records, 0001 onwards. [0018](decisions/0018-v2-pod-first-architecture.md) and [0019](decisions/0019-v2-package-map.md) are the design's spine |
| [research/](research/)                                                          | The evidence the design rests on: censuses, measurements and incidents                                                                                  |
| [realtime-pr-ci.md](realtime-pr-ci.md)                                          | How a PR and its CI reach a session                                                                                                                     |
| [artifacts.md](artifacts.md)                                                    | Artifacts: the repo that builds in the pod, push, pull and versions                                                                                     |
| [data/v1-archive.md](data/v1-archive.md)                                        | The frozen v1 tables in the `v1_archive` schema, their columns and the analytics queries that read them                                                 |
| [handoffs/](handoffs/)                                                          | Handoff briefs for slices already built. History; they name paths as they were                                                                          |
| [research/credential-availability/](research/credential-availability/README.md) | The parked credential-availability design (slices 1–4A merged, 4B parked for v2)                                                                        |
| [package-readmes.md](package-readmes.md)                                        | The template every package README follows                                                                                                               |

The research censuses are static reads of the repository at the commit each one names, not live
captures. Their `file:line` anchors may have moved on `main`; re-check an anchor before relying on
it.

## Decisions at a glance

|     | Decision                                                                                                   | State                 |
| --- | ---------------------------------------------------------------------------------------------------------- | --------------------- |
| D1  | The durable record lives in the control plane; the holder agent host is the only writer of seqs            | Locked                |
| D2  | Local control plane: a daemon (`atlasd`) running the same `control` library over SQLite                    | **Open**, recommended |
| D3  | The log is append-only; history edits are appended events                                                  | Locked                |
| D4  | Every durable input goes through the control-plane inbox                                                   | Locked                |
| D5  | Foundation packages plus plugins with a fixed shape (package map: 0019)                                    | Locked                |
| D6  | v1 and v2 storage and endpoints were separate while both ran (Prisma 8 `namespace v2`); v1 is now archived | Done                  |
| D7  | First target: web/mac with a cloud pod                                                                     | Locked                |
| D8  | The agent loop runs on the agent host; sandboxes only execute (0021)                                       | Locked                |
| D9  | Background jobs and schedules run on trigger.dev in `apps/trigger`, never in the agent host (0022)         | Locked                |
