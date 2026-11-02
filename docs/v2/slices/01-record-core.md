# Slice 1 spec: record core

Status: **draft, awaiting operator approval.** Sibling to [roadmap.md](../roadmap.md) slice 1. The design this
applies is [architecture.md](../architecture.md); decisions in
[0018](../../decisions/0018-v2-pod-first-architecture.md).

## Goal

The durable record, inbox and leases exist as pure rules in `core`, a storage-agnostic `control`
library, and a Postgres adapter in the v2 storage. Nothing pod-facing ships in this slice: no
pod, no client, no endpoint beyond what the adapter's own tests need. Slice 3 builds the pod host
(`packages/pod`) against these interfaces.

## What exists today (read at `a0bf4110`)

- **Rewind deletes rows.** `ThreadsHistoryService.rewind`
  (`apps/api/src/api/platform/sessions/threads-history.service.ts:67-98`) deletes events above
  `toSeq`, drops rewound child threads, lowers `Thread.head` and emits `eventsReset`. The pod
  truncates its JSONL through `packages/harness/src/store/sessions/thread-store-history.ts:27-54`.
- **Compaction already appends.** `history-compacted` events carry `fromSeq/throughSeq/anchor`
  and `packages/core/src/compaction/watermark.ts` folds them; only the `discardRows` path in the
  API's `mark()` removes rows.
- **Rewind planning is already pure.** `packages/core/src/events/rewind-plan.ts`,
  `rewind-target.ts`, `rewind-disposition.ts` and `loop-cut.ts` compute what a rewind cuts. Only
  applying the plan (the delete) changes in v2; killing a cut agent, shell or service stays.
- **Identity.** `packages/core/src/events/envelope.ts:4-12` has no epoch or `prevHash`.
  `packages/core/src/events/event-identity.ts` has a dependency-free `sha256Hex` to reuse; its
  `transcriptIdentityDigest` (sorted id/seq/type, no bodies) is not the v2 rule.
- **Storage.** Prisma 8 (CLI rc.24, adapter rc.19) supports `namespace v2 { ... }` blocks: the
  planner emits `createSchema({ schema: 'v2' })` and the client is `db.orm.v2.<Model>`, on the same
  pool as `packages/db/src/client.ts:9-11`. `--rename` cannot move a model between namespaces. The
  vendored reference is `packages/db/.agents/skills/prisma-8/references/contract.md`
  ("Namespaces").
- **Hazards from the extraction census:** both the pod
  (`packages/harness/src/store/sessions/event-log.ts:174-185`) and the API
  (`apps/api/src/api/platform/sessions/append.ts:177-200`) allocate seq and id; replication drops
  the id (`packages/harness/src/cloud/pod-event.ts`) and the API re-mints it
  (`apps/api/src/api/platform/sandboxes/pod-events.ts:70-83`). v2 copies none of this.

## Scope

### In scope

1. **Pure rules in `packages/core/src/record/`** (new folder):
   - `chain.ts` — event chain hashing: `chainHash(event) -> Hash`, `GENESIS_HASH`, verification of
     a suffix against a known head. Reuses `sha256Hex` from `core/src/events/event-identity.ts`.
     The envelope gains `prevHash: Hash` (v2 events only; v1 envelopes are untouched — see
     "Envelope versioning" below).
   - `log.ts` — the log state machine: `append(state, drafts) -> { events, state } | Refusal`.
     Seals the acceptance rule of D1: an append is accepted only when `epoch == current`,
     `seq == head + 1` (contiguous batch), and `prevHash` chains. Pure: state in, events or a
     typed refusal out. Refusals: `stale-epoch`, `seq-gap`, `hash-mismatch`.
   - `inbox.ts` — the inbox state machine: `post`, `takeBack`, `consume`. Monotonic inbox ids;
     take-back of an unconsumed entry is a delete; take-back of a consumed entry is a typed refusal
     (`already-consumed`) — the pod-side retraction is slice 3's concern, the rule only marks the
     boundary (P2).
   - `lease.ts` — holder lease state machine: `grant`, `renew`, `revoke`, `fence`. One holder per
     session at epoch N; every lifecycle move increments N; writes naming N < current are refused
     (P4). Lease expiry is a fact the control plane derives from `renewedAt + ttl`, not a callback.
   - `history.ts` — append-only history events (P5): `history-rewound{toSeq}`,
     `history-summarised{range, summaryEventSeq}`, and the **fold** that turns a raw event list into
     the visible event list. This is the piece that replaces physical truncation: the fold is what
     assembly and views consume, and it is pure.
2. **Envelope versioning.** v1 `EventEnvelope` stays as is. v2 events are a new envelope type in
   the same file family (`core/src/events/`), adding `prevHash` and minting `id` at append. The two
   never mix in one log: a v2 thread's events are all v2-envelope.
3. **`packages/control`** (new platform package, D5): the storage-agnostic control-plane library.
   Ports (abstract classes, harness DI style): `RecordStorePort` (append/read/head per thread,
   epoch-checked), `InboxStorePort`, `LeaseStorePort`, `SessionRegistryPort`. Logic: the
   coordination between the pure rules and the ports — e.g. `appendEvents` loads lease + head,
   runs `log.append`, persists in one transaction. No Nest, no tRPC, no HTTP.
4. **`packages/db` v2 namespace**: `namespace v2 { ... }` blocks under
   `src/prisma/schema/v2/` (D6, verified 2026-11-01: Prisma 8 rc.24/rc.19 namespaces emit a managed
   Postgres `v2` schema; client shape `db.orm.v2.*`). Models (one per file, repo convention):
   `V2Session`, `V2Thread`, `V2Event`, `V2InboxEntry`, `V2Lease`. Exact field lists are fixed when
   the adapter is written; `V2Event` carries `(threadId, seq)` unique, `id`, `prevHash`, `epoch`,
   `type`, `body` (json), `runId`, `at`.
5. **Postgres adapter in `packages/control/src/postgres/`** implementing the four ports over
   `db.orm.v2.*`. The SQLite adapter is slice 9 (D2); the ports must not assume Postgres semantics
   that SQLite lacks (no `LISTEN/NOTIFY`, no `FOR UPDATE SKIP LOCKED` — see "Portability rules").

### Out of scope

- The `agent` extraction (slice 2), the pod host (slice 3), views (slice 4), any client work
  (slice 5).
- Migrating or reading any v1 row. v2 starts empty (0012 applies).
- GC of dead-branch rows (P5 makes GC a storage policy; naming that policy is a follow-up, not
  this slice).
- Sub-agent multi-log-under-one-lease semantics (risk table row 2): the record core must not
  assume one log per lease, but child-thread spawning is specified in the sub-agents slice.

## Interfaces

Fixed by this spec's implementation, reviewed before slice 3 starts:

- `RecordStorePort.append(args: { threadId, epoch, events: readonly V2Event[] }) ->
  { ok: true; appended } | { ok: false; refusal: AppendRefusal; head: HeadState }` — the head is
  returned on refusal so the caller can resync without a second round trip.

  **The CP append takes complete holder-stamped events, never drafts.** The holder pod mints
  `id`, `seq` and `prevHash`; the control plane only validates (epoch fence, contiguity, hash
  chain) and stores. This is the inverse of v1's `EventLogPort.append(drafts)`
  (`packages/core/src/ports/event-log.port.ts:5-32`), which allocates identity at the store —
  the exact shape that let two allocators exist. The v1 port stays for v1; nothing in v2 reuses
  it. The pod-side "drafts → stamped events" allocation lives in slice 3's pod host, not in
  the control library.
- `InboxStorePort.post/consume/takeBack` mirroring the inbox state machine.
- `LeaseStorePort.grant/renew/revoke/current`.
- Pure folds: `visibleEvents(events) -> events` applying `history-rewound`/`history-summarised`;
  the v1 fold-equivalents (`rewind-plan.ts`, `compaction/watermark.ts`) stay for v1 until cutover —
  v2 does not edit them.

## Portability rules (adapter must hold for Postgres now, SQLite later)

- Ordering comes from `seq`/`inboxId` columns, never from insertion order or `SERIAL` trivia.
- The epoch fence is enforced in the library, with the adapter supplying compare-and-swap per
  store's idiom (a conditional `UPDATE … WHERE epoch = N` on Postgres; same shape works on SQLite).
- No database-specific types leak past the adapter: ids are branded strings, times are ISO
  strings, bodies are JSON.

## Dependency rules established in this slice (compiler-enforced)

- `core` stays zod-only.
- `control` imports `core`, `zod`, and `@dltech/atlas-db` (adapter subpath only); it never
  imports Nest, tRPC, or HTTP types. The Postgres adapter is a subpath (`control/postgres`), so
  the library's core is loadable without a database driver.
- `packages/db` gains no imports; the v2 namespace is schema-only.
- Nothing in this slice touches v1 call sites; v1 keeps its own append paths until cutover.

## Tests (exit criterion, from roadmap slice 1)

Property tests over the pure rules with a fast-check-style generator (or the repo's equivalent —
check what `core/src/__tests__` already uses before adding a dependency):

1. **seq-466 interleaving**: two concurrent inputs become inbox ids 1 and 2; one holder turns them
   into seqs 466 and 467; a second writer's append at 466 is refused.
2. **Stale epoch**: a write at epoch N after the lease moved to N+1 is refused with `stale-epoch`.
3. **Hash mismatch**: a tampered or skipped event makes the suffix's `prevHash` fail; refused with
   `hash-mismatch`, and hydration verifies the chain rather than trusting the head number.
4. **Append-only rewind**: `fold(log + history-rewound{toSeq})` equals v1's truncation result for
   the same log (differential test against a fixture, not against v1 code).
5. **Inbox take-back boundary**: unconsumed → deleted; consumed → `already-consumed`.
6. **Adapter conformance**: the same suite runs against the Postgres adapter (scratch database;
   the repo's test-database helper in `packages/db`) and passes.
7. **Migration cleanliness**: `prisma migration plan` + apply on a scratch database leaves v1
   tables untouched and creates the `v2` schema; rolling the migration back removes only v2.

## Open questions to resolve while building (not blocking)

- Exact `V2Event.body` representation (json column vs typed columns per event kind) — pick json;
  typed columns are a view-layer concern (slice 4).
- Whether `V2Lease` rows are per-session with thread rows pointing at them, or per-thread —
  the sub-agents slice prefers per-session with N logs; default to per-session.
- Hash chain across fork-by-reference prefixes (the child inherits a prefix it does not hold):
  the child's first own event chains to the fork point's hash, which the control plane can
  supply from the parent's record. Confirm in implementation, test in the sub-agents slice.
