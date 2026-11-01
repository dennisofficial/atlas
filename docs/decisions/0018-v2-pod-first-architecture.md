# 0018. v2 is a pod-first redesign: one writer per fact, the record in the control plane

Accepted 2026-11-01.

## Context

v1 was born as one process: the TUI owned the loop, the log, the metadata and the UI. Pods moved
the loop into a container and adapted that design with best-effort replication, so most state now
has two or three writers. A census found six conversation-seq allocators (four in the pod, two in
the API), nine API paths that allocate event seqs, and twelve kinds of change either side can
start. On 2026-11-01 the API's send path and the pod's local log both minted seq 466 within four
seconds. The API refused the pod's row, nothing healed the fork, and 560 events of derived state
(PR link, branch, worktree) froze while the session looked alive.
Evidence: [docs/v2/research/](../v2/research/incident-2026-11-01-seq466.md).

## Decision

v2 is a full redesign of the state and protocol architecture as client ⇄ control plane ⇄ pod, with
local and cloud as placements of the same shape. The business logic (loop, tools, providers,
assembly, prompts, hooks, skills, sub-agents) carries over. The design is
[docs/v2/architecture.md](../v2/architecture.md); the ordered slices are
[docs/v2/roadmap.md](../v2/roadmap.md).

- **D1.** The durable record lives in the control plane. The holder pod is the only writer of
  seqs. Clients and pods are agnostic to where the other is.
- **D3.** The log is append-only. History edits (rewind, summarise, compact, loop-cut) are appended
  events.
- **D4.** Every durable input goes through the control-plane inbox.
- **D5.** Platform packages (`core`, `protocol`, `runtime`, `control`, `client`) plus feature
  packages, each with the same shape: `/core` (events and pure folds), `/runtime`, `/control`,
  `/protocol`. Feature packages never import each other; apps compose. A feature becomes a
  package when it has parts in at least two tiers.
- **D6.** v2 storage is separate from v1: a Postgres `v2` schema if Prisma 8 supports it
  (`db.orm.v2.*`), otherwise `V2`-prefixed models. v2 endpoints live under their own namespace. At
  cutover everything goes v2.
- **D7.** The first target is web and mac with a cloud pod.
- **v1 keeps working** while v2 is built. v2 is a session kind chosen at creation; nothing
  migrates. A small v1 stopgap (the pod reconciles an append fork) ships separately.
- Everything in v2 is built clean and solid, and the design lives in the repo so work can span
  sessions.

**Still open — D2.** Recommended: the local control plane is a daemon (`atlasd`) running the same
`control` library over SQLite. The Mac host and the TUI connect to it or start it; local pods treat
it like any control plane. A session lives in exactly one control plane and never syncs between
them. It is built after the cloud slice; this record will be superseded or amended when D2 is
decided.

## Why

Patching each seam keeps the fork, because the cause is that state has no single owner. Making the
holder pod the sole seq allocator and routing input through a control-plane inbox removes the
interleaving that caused seq 466 by construction. The pod is the writer because it runs the loop
and must not pay a round trip per event; the control plane holds the record because a pod disk is
a cache that can die. An append-only log removes the rebase path that v1 forgot to wire for
loop-cut. Separate storage and endpoints let v1 keep running untouched, and avoid a table with
both a v1 and a v2 writer. Feature packages with one shape keep the tiers aligned per feature
while the compiler enforces that features stay independent.

## Consequences

- v1 and v2 coexist until cutover, with their own storage and endpoints; both need fixes in the
  meantime.
- Rewind, summarise, compact and loop-cut change implementation (appended events interpreted by
  assembly and folds). User-visible behaviour is meant to stay the same. This touches
  `docs/core-contract.md`.
- The client SDK and control-plane views replace client-side heuristics; an unknown value is shown
  as unknown.
- Nothing is built by this record. Each slice in the roadmap gets a spec before it is built.
- The local slices wait on D2.
- [0017](0017-wire-protocol-skew.md) still governs version skew; v2 extends its check to schema
  structure.
