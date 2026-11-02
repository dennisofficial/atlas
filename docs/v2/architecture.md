# Atlas v2 architecture

Authoritative design for v2. Status: **design, not built.** The decisions it applies are recorded
in [0018](../decisions/0018-v2-pod-first-architecture.md). One decision, D2 (the local control
plane), is still open and is marked where it matters. Where this file and the v1 code disagree
about _what v2 should be_, this file wins; where they disagree about what v1 _does_, the code wins.

Evidence for every claim about v1 is in [research/](research/). Anchors there are `file:line` at
commit `a18e7413` and may have drifted.

## 1. Why v2

v1 was born as one process: the TUI owned the loop, the log, the metadata and the UI. Rule 2 of
[docs/architecture.md](../architecture.md) ("One record") held because there was one place to
write. Pods moved the loop into a container, and every piece of state that used to have one home
now has two or three, joined by best-effort replication with no ownership rules:

- Six places assign conversation seqs: four in the pod, two in the API
  ([pod-side-state](research/pod-side-state.md)).
- Nine API code paths append to the event log; the pod appends in about 60 more
  ([control-plane-state](research/control-plane-state.md)).
- Replication drops the event id, so the pod log and Postgres can never be identical.
- Twelve kinds of change can be started by either the API or the pod: messages, PR events, title,
  model, history edits, child threads and more ([wire-surface](research/wire-surface.md)).
- Five protocols connect three tiers, and each surface (web, Mac, TUI cloud, TUI local, TUI
  in-process) has its own topology.
- Many "alive" signals (activity, checkpoint, boot steps, PR transport) advance independently of
  the transcript, so a frozen transcript looks healthy
  ([incident](research/incident-2026-11-01-seq466.md)).

Patching each seam keeps the fork. v2 changes who owns what and keeps the business logic.

## 2. What stays

- `core` stays pure. Context is still a fresh projection of the log on every step (rule 1).
- The event log is still the one record of a conversation (rule 2). v2 enforces it across tiers.
- The loop, tools, providers, assembly, compaction logic, prompts, hooks, skills and sub-agent
  semantics move over and are not rewritten.
- The port registry idea: every capability declares its runtime binding and its transport.
- Wire version negotiation ([0017](../decisions/0017-wire-protocol-skew.md)).

## 3. The tiers

```
  clients             control plane                       runtimes (pods)
  web / mac / tui <-> record + inbox + leases + views <-> cloud pod | local docker pod | in-process pod
                      (cloud: NestJS + Postgres;
                       local: atlasd over SQLite [D2, open])
```

| Tier                   | Owns                                                                                                                            | Does not own                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Client**             | Rendering views, sending commands, caches and drafts                                                                            | Any fact. It never infers state with heuristics                        |
| **Control plane (CP)** | The durable record, the inbox, holder leases, materialized views, external observations (GitHub), config, credentials, identity | Allocating conversation seqs; the workspace                            |
| **Runtime (pod)**      | The loop for the session it holds; the world (workspace, git, processes, files); allocating conversation seqs                   | The durable record. Its disk is a cache of the record plus world state |

Clients and pods are agnostic to where the other is: a client talks to _a_ control plane, a pod
talks to _a_ control plane, and neither needs to know whether the other is local or cloud.

"Local" is a placement, not a different architecture. An in-process TUI session is a pod that runs
inside the TUI's process and speaks the same protocol over loopback.

**A session lives in exactly one control plane and never syncs between them.** Cloud sessions
live in the cloud CP; local sessions live in the local CP. There is no replication between control
planes.

**D2 (open): the local control plane.** Recommended: a daemon, `atlasd`, running the same
`control` library over SQLite. The Mac host and the TUI connect to it or start it, and local pods
treat it like any control plane. The alternative, requiring cloud sign-in and using the cloud CP
for local sessions, loses offline work and makes local a different shape. The daemon is built
after the cloud slice, so nothing in the cloud slices depends on the answer; the `control` library
is storage-agnostic so that either answer fits.

## 4. Ownership principles

**P1. One writer per fact.** Every piece of state names exactly one writer. Everything else is a
replica that says how far behind it may be. Each row in the §6 table follows this rule.

**P2. Two streams per session: inbox in, log out.**

- _Inbox_: operator inputs (send, take-back, stop, model change, rename, rewind request). Only the
  CP creates inbox entries, each with a monotonic inbox id (D4). The pod consumes entries and
  records the inbox id it consumed in the log (`input-consumed{inboxId}`). Take-back of an entry
  the pod has not consumed is a CP-only delete. Once the pod has consumed it, take-back is a
  request to the pod.
- _Log_: only the current holder allocates seqs (D1). The CP stores the durable copy and accepts
  an append only when `epoch == current && seq == head+1 && prevHash` matches. Under this rule the
  seq-466 interleaving cannot happen: two sends become inbox ids 1 and 2, and the pod turns them
  into seqs 466 and 467.

**P3. Event identity is end to end.** The pod mints `id` at append time and every copy keeps it.
Each event carries `prevHash`, the hash of the previous event, so "are these two copies the same
up to seq N" is one comparison. Hydration verifies the hash instead of trusting the head number.
This replaces the three equality notions found in v1 (API content equality, host pod-copy id
equality, checkpoint digest of id+seq+type).

**P4. Epoch fencing replaces liveness guessing.** The CP grants one holder lease per session at
epoch N. Every move, wake, resize, rollover or recreation increments the epoch. The CP rejects
writes from an older epoch. A pod that loses its lease stops its loop. Parking becomes: flush the
log, release the lease. The fence replaces the wake-claim CAS, checkpoint revision races, the
`park-refused unflushed` guard and most of the runtime checkpoint's job.

**P5. The log only grows (D3).** Rewind, summarise, compact and loop-cut become appended events
(`history-rewound{toSeq}`, `history-summarised{range}`) that the assembly rules and view folds
interpret. Nothing truncates or replaces history, so replication is append-only and no rebase path
exists to forget. Garbage collection of dead branches is a storage policy, not semantics. This
changes how rewind is implemented, not what the user sees.

**P6. Views are pure folds in core, materialized by the CP.** Branch, worktree, PR links, status,
unread, subscriptions summary, title, model: each is a function `fold(log[, observations]) -> view`
in `core`. The CP computes each view at a log position and ships it with that position. Clients
render views and never re-fold or guess. The branch-match PR fallback and the project-baseBranch
checkout fallback (the reason the incident thread showed `staging`) disappear: an unknown value is
shown as unknown. Session status is `fold(log) ∧ holder lease liveness`, not a separately written
`working` column.

**P7. Commands are durable through the CP. Only ephemeral data goes direct.** A client may keep a
direct socket to the pod, because Vercel functions cannot hold long WebSockets, but that socket
carries only ephemeral things: token deltas, live tool output, the PTY, file browsing and an
interrupt _hint_. Anything that must survive goes through the inbox or comes from the record. A
stop is both: a direct hint for latency and a durable inbox entry for truth.

**P8. Features are modules with a contract.** A feature (GitHub/PR, subscriptions, shells,
services, sub-agents, memory, previews) declares:
`events` (schemas it emits) · `views` (pure folds) · `commands` (inbox entries it accepts) ·
`pod` (pod handlers) · `control` (CP handlers: observations, side effects) · `client` (headless
client state) · `transport` (none, or which stream). It is registered the way ports are today, and
typecheck fails if a slot is missing. Native plugins and native commands are built on this
contract. §7 gives the package shape.

## 5. Protocol: one, three directions

| Direction                                 | Carries                                                                                                                                                                 | Mechanism                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Client ⇄ CP**                           | Commands and queries; one ordered session stream per open session (`{log suffix \| view updates}` with a cursor `(epoch, seq)`); the sidebar as one stream of view rows | tRPC plus SSE                                        |
| **Pod → CP**                              | `append(epoch, events[])` (batched, contiguous, hash-chained); `lease.renew`; observation reports                                                                       | HTTP                                                 |
| **CP → pod**                              | Inbox entries and lease revocations                                                                                                                                     | An inbox stream (SSE) held open by the pod           |
| **Client ⇄ pod** (direct, ephemeral only) | Deltas, PTY, file tree, interrupt hint                                                                                                                                  | WebSocket, authorized by a CP-minted ticket as today |

- Streams reconnect with cursors. Vercel serverless caps SSE at about 240 s, so reconnect is the
  normal case, not an error path.
- Version negotiation carries over from [0017](../decisions/0017-wire-protocol-skew.md). The skew
  check is extended to cover schema structure, not only versions and three enums.
- v2 endpoints live in their own namespace, separate from the v1 routes (D6).
- Cursor spaces stay distinct: the durable `(epoch, seq)`, and any transport replay cursor. v1
  conflates three (see [wire-surface](research/wire-surface.md)); v2 does not.

## 6. Where each piece of state moves

| State                                    | v1 writers today                                                      | v2 single writer                                                      | Replicas                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Conversation events / seq                | pod (4 allocators) + API (send, append, open, wake, archive, history) | holder pod                                                            | CP record (durable), clients (views, log suffix)                         |
| Operator input                           | WS send (pod intake) + API send (Postgres append)                     | CP inbox                                                              | pod consumes; `input-consumed` in log                                    |
| History edits                            | API rewind/replace/summarise/fork + pod rewind/compact/loop-cut       | pod, as appended events (P5)                                          | none needed                                                              |
| Child / teammate threads                 | API create/open + pod spawn + registerChild                           | pod mints and logs `agent-spawned`; CP materializes rows from the log | CP rows are a view                                                       |
| Title, model                             | API rename/chooseModel + serve requests + forwarding + home copy      | inbox command → pod logs `title-set` / `model-set`                    | view                                                                     |
| PR links, branch, worktree               | events + session meta + client heuristics                             | log events (`checkout-placed` / `checkout-left` per thread, 0020)     | view: the session's checkout set, with PR state joined by github         |
| Subscriptions                            | runtime registry + event projection + GithubSubscription rows         | log events (intent)                                                   | CP derives transport leases from the view                                |
| PR state / checks                        | GitHub → CP cache, pod cache, client merge                            | CP observation store                                                  | joined into views; pod reads it                                          |
| Activity / status                        | pod → Thread.working etc., checkpoint, boot steps                     | fold(log) + lease liveness                                            | view                                                                     |
| Runtime checkpoint                       | pod file + API mirror                                                 | mostly gone; lease + log replace it                                   | none                                                                     |
| Accounts, secrets, settings, MCP         | CP + pod whole-file rewrite + harness writes                          | CP                                                                    | pod gets a read-only, revisioned lease; the pod never writes these files |
| Workspace, git, processes, context files | pod (world) + API/home mirrors                                        | pod                                                                   | mirrors labelled with as-of position, never read as truth                |
| Read cursor                              | API, Mac, TUI separately                                              | CP                                                                    | none                                                                     |
| Drafts, uploads                          | CP (last write wins)                                                  | CP                                                                    | none                                                                     |
| Spend ledger                             | pod + Turn upsert                                                     | pod logs `turn-ended{usage}`                                          | CP view                                                                  |

## 7. Package shape

Fixed by [0019](../decisions/0019-v2-package-map.md), which amends D5. Foundations live in
`packages/`; native plugins in a top-level `plugins/`; native commands in a top-level `commands/`.
Bun runs TypeScript raw, so a package costs no build step; the maintainer prefers a few large,
cohesive packages where each feature's code sits in one place.

**Foundation packages (`packages/`)**

| Package      | Owns                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `core`       | Pure shared vocabulary: ids, event envelope, assembly, and the record rules (log, inbox, lease, history folds)             |
| `protocol`   | Wire schemas for the three directions (today's `wire`, without sandbox provisioning I/O or the ticket HMAC implementation) |
| `agent`      | The loop every agent runs: turn runner, retries, intake, tool dispatch, model port. Knows nothing about pods or leases     |
| `pod`        | Hosts agents in a pod: holds the lease, local record cache, replication, inbox consumption (0018 called this `runtime`)    |
| `control`    | The CP library: record, inbox, leases, view materialization. Adapters: Postgres (hosted by `apps/api`), SQLite (D2)        |
| `client`     | The client SDK and headless React hooks shared by web, TUI and Mac: session stream, view cache, commands                   |
| `plugin-sdk` | The plugin contract (slots), the type-level registries and the loader; native and repo plugins share it                    |
| `commands`   | The command contract: spec, arguments, registry, dispatch as inbox commands, the shared command menu and its hooks          |
| `settings`   | Settings schema and resolution (pure) plus per-tier subpaths; plugins contribute keys                                      |

`ui`, `db` and `models` are unchanged.

**Plugins (`plugins/<name>/`).** One workspace package per native plugin (github, subscriptions,
shells, services, crew, sessions, memory, previews). Every plugin has the same subpaths:

| Subpath    | Holds                                                          |
| ---------- | -------------------------------------------------------------- |
| `/core`    | The plugin's events, pure folds (views) and command specs      |
| `/pod`     | Pod-side handlers: tools, hooks, inbox command handlers        |
| `/control` | CP-side handlers: observations, side effects                   |
| `/client`  | Headless client state and hooks; rendering in `web` and `tui`  |

**Commands (`commands/`).** One workspace package with a folder per native session command: `spec.ts`,
`pod.ts` (the handler, run in the pod from an inbox command), `client.ts` (headless hooks),
`web.tsx` and `tui.tsx` (rendering; Mac renders the web build). A command that belongs to a feature
lives in that plugin on the same contract.

Rules:

- Plugins never import each other. Anything two plugins share belongs in a foundation package.
- Every command is an inbox command handled in the pod, so it behaves identically on every client.
- Apps compose: each app imports the tier subpaths it needs and registers them. The type-level
  registry (P8) fails typecheck if a plugin is registered without its slots.
- Tier boundaries are enforced by subpath exports plus a restricted-import lint rule.
- Before any feature event leaves `core`, `plugin-sdk` provides a type-level event registry so the
  exhaustive switches over `EventBody` stay exhaustive.

## 8. Running v1 and v2 side by side

- v2 is a session kind (`engine: v2`) chosen at creation, behind a flag. v1 sessions run v1 code
  until they end. Nothing migrates; v2 starts empty, as [0012](../decisions/0012-cloud-state-starts-empty.md)
  did for pods.
- **Storage is separate (D6).** v2 uses a Postgres `v2` schema via Prisma 8's first-class
  `namespace v2 { ... }` blocks (verified on the repo's pins, rc.24 CLI / rc.19 adapter:
  `prisma migration plan` emits `createSchema({ schema: 'v2' })`, the client is `db.orm.v2.*`).
  The `V2`-prefixed-model fallback is not needed. No table has a v1 writer and a v2 writer.
- **Endpoints are separate (D6).** v2 routes live under their own namespace. v1 routes are not
  changed for v2's sake.
- **At cutover everything goes v2.** There is no permanent dual mode and no per-table migration
  plan to maintain.
- Shared business logic is extracted into runtime-agnostic packages as each feature moves. v1
  imports the extracted code too, so there is one copy.
- Clients list both kinds. A v2 session opens through the new client SDK.
- **Daily driver.** Atlas is used daily through atlas-web and atlas-mac with cloud sessions, so
  those are the first v2 targets (D7) and v1 cloud keeps running next to them. The in-process v1
  TUI keeps working until v2 local has proven itself on real work. Nothing in v1 is removed before
  then.
- **v1 stopgap (shipped, #1649).** The pod reconciles an append fork with the API instead of
  wedging: it re-delivers any API-taken message it never saw through its own allocator, truncates
  the API replica below the fork and re-ships its log. It applies P2 to v1 and is deleted with v1.
  The wedge is narrowed, not gone: a failed truncate, a repeated conflict after healing, and the
  in-memory mid-turn deferral window can still stall a flush
  ([pod-side-state](research/pod-side-state.md)).

## 9. Order of work

[roadmap.md](roadmap.md) has the slices, their exit criteria, the current state and the
session-per-slice workflow. Each slice gets a spec in [slices/](slices/) before it is built, and
merges to `main` with v1 still working, so it can be tested between sessions. The first milestone
is a real cloud session on v2 from the web, with basic chat and tools.

## 10. Risks

| Risk                                                          | Why it matters                                                                                                                                | Mitigation                                                                                                 |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| The rewrite stalls and two systems need upkeep                | v1 and v2 both need fixes for as long as they coexist                                                                                         | Shared logic stays one copy; the first milestone is usable early; features move one at a time              |
| Sub-agent families                                            | One session holds several thread logs under one lease. Each log needs the same append rules, and spawn and ending must be events in both logs | Narrowed by [0020](../decisions/0020-v2-sub-agent-worktrees-and-peer-sessions.md): teammates become peer sessions, so only short-lived sub-agents with no PR or CI share a lease. Settled in the crew spec; the record core must not assume one log per lease |
| Rewind as append-only (P5)                                    | Touches assembly rules and `docs/core-contract.md`; the highest-semantic-risk change                                                          | Specified and property-tested in slice 1, before the pod host depends on it                                 |
| Vercel serverless limits (no long WebSocket; SSE about 240 s) | Streams drop routinely                                                                                                                        | Cursors on every stream; reconnect is the normal path                                                      |
| Interim v1 pain                                               | v1 can wedge the same way while v2 is built                                                                                                   | The v1 stopgap (§8)                                                                                        |
| ~~The v2 schema is not supported by Prisma 8~~ (retired)      | Verified 2026-11-01: Prisma 8 namespaces work on the repo's pins; `db.orm.v2.*` and a managed `v2` Postgres schema in the same migration graph | None needed; D6 uses `namespace v2` blocks directly                                                        |
| D2 stays open too long                                        | The local slices cannot be specified                                                                                                          | D2 is needed only at the local slice; cloud slices do not depend on it                                     |
| A saturated pod starves the harness                           | Slow streaming and sends, missed lease renewals (a live pod fenced, the session flapping), the harness OOM-killed before the workload         | §11: OOM and CPU priority, a memory watchdog, lease renewal and stop that do not wait on the loop          |

## 11. Pod resources: the harness outranks its workloads

A pod runs two kinds of process: the **harness** (the `pod` host and the `agent` loop it runs) and
the **workloads** the agent starts (shells, services, test runs, builds). They share the pod's CPU,
memory and disk. When a workload saturates the pod, the model call is unaffected (it runs remotely),
but everything the harness does locally slows: streaming, sends, event writes, flushes, lease
renewal and stop. In v1 the harness is also the kernel's first OOM victim (it has the largest
footprint and `oom_score_adj` 500). This is OS-level isolation, not a package boundary.

What a Vercel pod allows (probed 2026-11-02, as root): `oom_score_adj` and negative nice work;
cgroup v2 delegates `cpu`, `cpuset` and `pids` to child groups but not `memory` or `io`; there is no
PSI (`/proc/pressure`). So memory cannot be capped per group and must be policed by the harness.

**R1. The harness survives.** The harness runs at a strongly negative `oom_score_adj`; every
workload starts with a high one, so the kernel kills workloads first. (v1 fix, carried into `pod`.)

**R2. The harness keeps CPU.** Workloads run at lower priority than the harness (nice, or a
low-`cpu.weight` cgroup), and the workload group has a `pids.max` so a fork bomb cannot take every
process slot. Workload output is read in bounded chunks so a noisy process cannot monopolise the
harness's event loop.

**R3. A memory watchdog acts before the kernel does.** Without a per-group memory limit, the
`pod` host watches available memory. Below a threshold it kills the largest workload process group
and appends an event saying which workload was killed and why, so the agent sees it in its context
and the operator in the transcript.

**R4. Liveness does not wait on the loop.** Lease renewal runs on its own timer, independent of
turn progress, and its TTL is sized for a saturated pod, so a busy pod is never fenced as dead.
Stop arrives twice (P7): the direct hint makes the pod kill the running tool's process group at
once rather than at the loop's next step, and the inbox entry is the durable record of it.

**If the harness dies anyway**, the design absorbs it: the record is in the control plane, the
lease expires, and a new pod resumes at the next epoch with nothing forked. At most the unflushed
tail is lost, bounded by the flush cadence. In v1 the same death wedges or loses the session.

Thresholds, TTLs and the priority mechanism are fixed in the slice 3 spec and measured on a
saturated pod, not chosen here.

