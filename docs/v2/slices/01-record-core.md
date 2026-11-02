# Slice 1 spec: record core

Status: **approved 2026-11-02.** Sibling to [roadmap.md](../roadmap.md) slice 1. The design this
applies is [architecture.md](../architecture.md); decisions in
[0018](../../decisions/0018-v2-pod-first-architecture.md).

## Goal

The durable record, inbox and leases exist as pure rules in `core`, a storage-agnostic `control`
library over one transactional storage port, and a Postgres adapter in the `v2` namespace. No
call reads a whole log. Nothing pod-facing ships: no pod, no client, no endpoint. Slice 3 builds the pod host (`packages/pod`) against these
interfaces.

## What exists today (read at `f3d629e3`)

- **Rewind deletes rows.** `ThreadsHistoryService.rewind`
  (`apps/api/src/api/platform/sessions/threads-history.service.ts:67-103`) deletes events above
  `toSeq` and lowers `Thread.head`; `summarise` (`:113-123`, via `mark` at `:197-286`) deletes the
  covered non-`SURVIVES_SUMMARY` rows and writes a `history-compacted` stand-in. The pod truncates
  its JSONL through `packages/harness/src/store/sessions/thread-store-history.ts:27-54`.
- **Rewind planning is already pure** (`packages/core/src/events/rewind-plan.ts`,
  `rewind-target.ts`, `rewind-disposition.ts`, `loop-cut.ts`). v2 does not edit them.
- **Identity.** `packages/core/src/events/envelope.ts:4-12` has no epoch or `prevHash`.
  `packages/core/src/events/event-identity.ts:99` exports a dependency-free `sha256Hex`
  (≈67 ms per 5 MB in Bun). `packages/core/src/services/declaration-identity.ts:4-14` has a private
  sorted-key `canonical()`; the record gets its own exported, stricter one.
- **v1 append allocates identity at the store** (`packages/core/src/ports/event-log.port.ts:5-32`,
  `append(drafts)`). That shape let two allocators exist; v2 reuses none of it.
- **Storage.** Prisma 8 (CLI rc.24, adapter rc.19) supports `namespace v2 { ... }`: the planner
  emits `createSchema({ schema: 'v2' })`, the client is `db.orm.v2.<Model>` / `db.sql.v2.<table>`
  on the shared pool (`packages/db/src/client.ts`). Reference:
  `packages/db/.agents/skills/prisma-8/references/contract.md` ("Namespaces") and
  `queries-postgres.md` ("Namespace-aware accessors"; row locks `forUpdate()`/`forNoKeyUpdate()`).
- **Test databases.** `useTestDatabase()` (`packages/db/src/testing/use-test-database.ts`) builds a
  template from every `migrations/app/*/ops.json` and truncates before each test;
  `truncateAll` (`packages/db/src/testing/test-database.ts:90-97`) only covers schema `public`.
  Local lane: `bun run --cwd packages/db db:test:up` (Postgres 17 on :55441); CI has the same
  service container.
- **No property-test library** in the repo. `fast-check` is added as a **dev** dependency of
  `core` and `control`; `core`'s runtime stays zod-only
  (`packages/core/src/__tests__/purity.spec.ts` checks `dependencies` only).

## Scale rules

**Realistic size** (production `Event` table, read 2026-11-02): the longest thread is 7,989 events
and 8 MB of bodies, from one day of heavy work; p50/p90/p99 per thread are 177/637/2,056 events;
the largest single event is 2.9 MB. Sessions last hours to days, not months. The design target is
**~20k events (~20–50 MB) per thread**, 2.5× the longest seen. The rules below avoid O(log) work
where avoiding it is trivial; they are not tuning for sizes Atlas does not reach. The nearer limit
is single large events against the 4 MB API body cap, which slice 3 owns.
1. No port or library call reads a whole log. Every read is ranged and keyset-paged (`afterSeq`,
   `limit ≤ 1000`).
2. Append is O(batch). The head seq and head hash live on the `V2Thread` row, read under a row lock
   and compare-and-swapped there, never derived by scanning `V2Event`.
3. Visibility is an incremental step function (`stepVisibility`). The CP keeps its state on the
   `V2Thread` row, updated in the append transaction, so a ranged read returns visible events
   without folding from seq 1.
4. Chain verification is incremental: a fetched suffix is verified against a trusted head hash,
   never the whole chain.
5. Exit test: ~20k events on Postgres; append latency and ranged-read cost stay flat as the log
   grows.

## The pure rules: `packages/core/src/record/` (new, exported from `core`'s index)

### `canonical.ts`

`canonicalJson(value: unknown): string`: sorted object keys, no whitespace, `undefined` members
dropped, strings through `JSON.stringify` (NUL becomes the six characters `\u0000`; lone surrogates
are escaped), so the output is text any `text` column round-trips byte for byte. Throws on
non-finite numbers, `bigint`, functions and non-plain objects.

### `event.ts`: the v2 envelope and body

```ts
export type Hash = string & { readonly __brand: 'Hash' } // 64 lowercase hex
export type RecordEnvelope = {
  id: EventId
  seq: number
  threadId: ThreadId
  runId: RunId
  parentRunId?: RunId | undefined
  depth: number
  at: string // ISO
  epoch: number
  prevHash: Hash
}
export type RecordBody =
  | { type: 'history-rewound'; toSeq: number }
  | {
      type: 'history-summarised'
      fromSeq: number
      throughSeq: number
      anchor: ECompactionAnchor
      summary: string
    }
  | { type: 'input-consumed'; inboxId: number }
export type V2Body = Exclude<EventBody, { type: 'history-compacted' }> | RecordBody
export type V2Event = V2Body & RecordEnvelope // distributed like Stamped<>
```

v1's `EventEnvelope`/`EventBody` are untouched; `RecordBody` never joins v1's union. `V2Body` excludes v1's `history-compacted` (v2 uses `history-summarised`); the schema rejects it as `malformed`. Seqs start at
1; an empty thread has head `{ seq: 0, hash: GENESIS_HASH }`. A zod `v2EventSchema` for ingest
validation reuses `eventBodySchema` (`core/src/events/schema.ts`).

### `chain.ts`

- `GENESIS_HASH: Hash` = 64 zeros.
- `canonicalEvent(event) = canonicalJson(event)` (the full event, `prevHash` included);
  `chainHash(event) = sha256Hex(utf8(canonicalEvent(event)))`.
- `verifySuffix({ trusted: { seq, hash }, events }) -> { ok: true; head } | { ok: false; atSeq;
  reason: 'seq-mismatch' | 'hash-mismatch' }`. Events start at `trusted.seq + 1`, are contiguous,
  and each `prevHash` equals its predecessor's hash (the first equals `trusted.hash`). O(suffix).

### `log.ts`: the append acceptance rule (D1)

```ts
type LogHead = { seq: number; hash: Hash }
type AppendRefusal =
  | { kind: 'stale-epoch'; current: number }
  | { kind: 'lease-expired' }
  | { kind: 'seq-mismatch'; expected: number }
  | { kind: 'hash-mismatch'; atSeq: number }
  | { kind: 'malformed'; atSeq: number; issue: string }
acceptAppend({ head, lease, now, epoch, events }) ->
  { ok: true; head: LogHead; hashes: Hash[] } | { ok: false; refusal: AppendRefusal }
```

Validates, never allocates. Order: epoch fence (the request epoch and every event's `epoch` equal
the current lease epoch and the lease has a holder, else `stale-epoch`), liveness
(`now < renewedAt + ttlMs`, else `lease-expired`), contiguity (first seq is `head.seq + 1`, no
gaps, else `seq-mismatch`), chain (`prevHash` links, else `hash-mismatch`). An empty batch is
`malformed`; that check runs after the epoch fence and liveness. Returns each event's hash for the adapter to store.

### `inbox.ts`

Pure moves over one entry: `takeBack(entry)` → `delete` when unconsumed, refusal
`already-consumed` when consumed; `consume({ entry, seq })` → the consumed entry, refusal
`unknown-inbox-entry` (absent, e.g. taken back first) or `already-consumed`. Inbox ids are
monotonic per session, allocated by the CP from a counter on `V2Session`. There is no public
`consume`: consumption happens only through `input-consumed` in the log.

### `lease.ts`

`Lease = { sessionId; epoch; holderId: string | null; renewedAt: string; ttlMs: number }`.
`grant({ lease, holderId, ttlMs, now })` → epoch+1, new holder. `renew({ lease, holderId, epoch,
now })` → refused `stale-epoch` (wrong epoch or holder) or `lease-expired`. `revoke({ lease, now })`
→ epoch+1, holder null. `isLive({ lease, now })`. Expiry is derived from `renewedAt + ttlMs`;
nothing is a callback. Time comes in as ISO strings; core reads no clock.

### `visibility.ts`: append-only history (P5)

```ts
type HiddenSpan = { createdAt: number; fromSeq: number; throughSeq: number;
                    keepSurvivors: boolean }   // summarised spans keep SURVIVES_SUMMARY types
type VisibilityState = { spans: HiddenSpan[] }   // canonical JSON on V2Thread
stepVisibility(state, event: V2Event): VisibilityState
isVisible(state, event): boolean
visibleSegments({ state, fromSeq, throughSeq }): { fromSeq; throughSeq; onlyTypes?: EventType[] }[]
visibleEvents(events): V2Event[]                 // fold from genesis; tests and small logs only
```

Step rules: `history-rewound{toSeq}` at seq R drops every span created after `toSeq` and adds
`{ createdAt: R, fromSeq: toSeq+1, throughSeq: R, keepSurvivors: false }` (the marker itself is
hidden). `history-summarised{fromSeq, throughSeq}` at seq S adds `{ createdAt: S, fromSeq,
throughSeq, keepSurvivors: true }`; the summary event itself is visible at S (placement by
`anchor` is assembly, slice 2/3). Other events leave the state unchanged. Adjacent spans with equal
`keepSurvivors` may coalesce. State grows with live history edits, never with log length.
`visibleSegments` turns the state into seq windows so the adapter skips hidden ranges instead of
reading and discarding them.

## `packages/control` (new workspace package `@dltech/atlas-control`)

Dependencies: `@dltech/atlas-core`, `zod`; `@dltech/atlas-db` only from the `./postgres` subpath.
Exports `.` (library, port, in-memory adapter, conformance suite factory) and `./postgres`. No
Nest, tRPC or HTTP.

### The storage port (one seam, two adapters)

```ts
export abstract class ControlStorePort {
  abstract transact<T>(work: (tx: ControlTx) => Promise<T>): Promise<T>
}
```

`ControlTx` is a narrow store handle; it decides nothing:
- `createSession`, `createThread` (head `0`/`GENESIS_HASH`, empty visibility state).
- `lockThread(threadId) -> ThreadRow | undefined`: row lock until the transaction ends
  (`FOR NO KEY UPDATE` on Postgres; `BEGIN IMMEDIATE` on SQLite). `ThreadRow = { threadId,
  sessionId, headSeq, headHash, visibility }`.
- `writeThreadHead({ threadId, expectedHeadSeq, headSeq, headHash, visibility }) -> boolean`
  (CAS on `headSeq`).
- `insertEvents(rows: StoredEvent[])`, `StoredEvent = { threadId, seq, id, epoch, type, runId, at,
  prevHash, hash, canonical }`. The `(threadId, seq)` primary key is the backstop.
- `readEvents({ threadId, afterSeq, throughSeq, limit, onlyTypes? }) -> StoredEvent[]`, ascending.
- `readLease(sessionId)`, `writeLease({ lease, expectedEpoch }) -> boolean` (CAS on epoch).
- `allocateInboxId(sessionId)`, `insertInboxEntry`, `readInboxEntry`,
  `markInboxConsumed({ sessionId, inboxId, seq }) -> boolean` (CAS on unconsumed),
  `deleteInboxEntry({ sessionId, inboxId }) -> boolean` (CAS on unconsumed),
  `readInboxEntries({ sessionId, afterId, limit })` (unconsumed, ascending).

### The library interface (what slice 3 calls)

`new ControlPlane({ store, clock: () => string })`:
- `createSession({ sessionId })`, `createThread({ threadId, sessionId })`.
- `append({ threadId, epoch, events }) -> { ok: true; head } | { ok: false; refusal; head }`. One
  transaction: lock the thread, read the lease, parse with `v2EventSchema` (`malformed`), run
  `acceptAppend`, step visibility per event, for each `input-consumed{inboxId}` run
  `inbox.consume` + `markInboxConsumed` (a refusal rolls the whole append back), insert rows
  (`canonical = canonicalEvent(event)`, `hash` from the rule), CAS the head. The head comes back on
  refusal so the caller resyncs without a second round trip. O(batch).
- `head({ threadId }) -> { seq, hash }`.
- `readEvents({ threadId, afterSeq, limit, visible }) -> { events: V2Event[]; next?: number }`:
  keyset paging; `visible: true` reads only `visibleSegments`. Each row is parsed from `canonical`
  and checked `sha256(canonical) === hash` (verified on ingest and on read).
- `post({ sessionId, kind, payload }) -> { inboxId }`, `takeBack({ sessionId, inboxId })`,
  `readInbox({ sessionId, afterId, limit })`.
- `grant`, `renew`, `revoke`, `currentLease({ sessionId }) -> { lease; live }`.

### Adapters

- **In-memory** (`src/memory/`): the second adapter that makes the port real, and the fast lane for
  the conformance suite. Transactions are serialized and roll back on throw.
- **Postgres** (`src/postgres/`, subpath `./postgres`): `PostgresControlStore` over a given `Db`,
  using `tx.orm.v2.*` / `tx.sql.v2.*` inside `db.transaction`.

### Portability rules (Postgres now, SQLite at D2)

- Order from `seq`/`inboxId` columns only.
- Every acceptance decision lives in `core`/the library; adapters supply CAS in their idiom
  (`UPDATE … WHERE epoch = N`).
- No `LISTEN/NOTIFY`, no `SKIP LOCKED`. Ids are branded strings, times ISO strings, bodies
  canonical JSON text.

## `packages/db`: the `v2` namespace

Files under `src/prisma/schema/v2/`, one model per file, first line `// use prisma-8`, each wrapped
in `namespace v2 { ... }`. The builder settles exact attributes; required shape:
- `V2Session { id @id, nextInboxId Int, createdAt }`
- `V2Thread { id @id, sessionId → V2Session, headSeq Int, headHash String, visibility String,
  createdAt }`
- `V2Event { threadId → V2Thread, seq Int, id String @unique, epoch Int, type String, runId String,
  at, prevHash String, hash String, canonical String; @@id([threadId, seq]);
  @@index([threadId, type, seq]) }`
- `V2InboxEntry { sessionId → V2Session, inboxId Int, kind String, payload String, postedAt,
  consumedSeq Int?; @@id([sessionId, inboxId]) }`
- `V2Lease { sessionId @id → V2Session, epoch Int, holderId String?, renewedAt, ttlMs Int }`

**Body column.** `canonical` and `payload` are `text`, not `jsonb`: jsonb normalizes key order,
whitespace and duplicate keys and rejects `\u0000`, which tool output contains. `canonicalJson`
writes NUL as the escape `\u0000`, so `text` (which refuses raw NUL bytes) round-trips the hashed
bytes exactly. Timestamps are `TimestamptzJsDate(3)` (repo rule). Leases are per session; the
sub-agents slice adds more threads under one lease.

One migration: `bun run contract:emit && bunx prisma migration plan --name v2_record_core`, then
`bunx prisma migration ref set db <hash>`. `truncateAll` also truncates schema `v2`.

## Dependency rules (compiler- and spec-enforced)

- `core` stays zod-only at runtime; `fast-check` is a dev dependency.
- `control` never imports Nest, tRPC or HTTP; only `src/postgres/` imports `@dltech/atlas-db` (a
  boundary spec in `control` checks it).
- `packages/db` gains no imports. No v1 call site changes.

## Seams under test (agreed)

1. **The pure rules** (`core/record`): `acceptAppend`, inbox and lease moves, `verifySuffix`,
   `stepVisibility`/`visibleEvents`/`visibleSegments`, `canonicalJson`. Property tests with
   fast-check.
2. **The `ControlPlane` interface**: one conformance suite, run against the in-memory and the
   Postgres adapter.
3. **The migration**: plan/apply on a scratch database.

Nothing tests adapter internals or queries tables directly, except at the migration seam.

## Exit tests

1. **seq-466 interleaving** (pure + conformance): two posts become inbox ids 1 and 2; the holder
   appends seqs 466–467 consuming both; a second writer's append at 466 is refused
   `seq-mismatch { expected: 468 }`.
2. **Stale epoch**: a write at epoch N after the lease moved to N+1 → `stale-epoch`; an expired
   lease → `lease-expired`.
3. **Hash mismatch**: a tampered or skipped event → `hash-mismatch`; `verifySuffix` catches a
   tampered stored row against a trusted head.
4. **Append-only rewind**: property test: for generated logs with interleaved rewinds and
   summaries, `visibleEvents(log)` equals a hand-written reference truncation model in the spec
   (not v1 code), and `visibleSegments`-driven reads equal `visibleEvents` over every range.
5. **Inbox boundary**: unconsumed take-back deletes; consumed → `already-consumed`; consuming a
   taken-back entry → `unknown-inbox-entry` and the append rolls back.
6. **Conformance**: the suite passes on both adapters, including NUL and lone-surrogate bodies
   round-tripping with identical hashes.
7. **Migration**: applying the graph on a scratch database leaves every `public` table's DDL
   unchanged and creates schema `v2`, and every forward statement of the migration is confined to
   schema `v2` (no `DROP`, no `RENAME`, no `public`). Prisma 8 has no down migrations and the repo
   fixes forward, so no reverse plan is tested.
8. **Scale** (gated by `ATLAS_SCALE_TESTS=1`): ~20k events appended in batches on Postgres; p50
   latency of a 50-event append near head 20k is within 2× of one near head 1k, a 500-event ranged read at the tail is within 2× of
   one at the start (each bound is "within 2× or ≤5 ms absolute difference"), and `EXPLAIN` of the ranged read shows an index scan, never a sequential scan.

## Open, not blocking

- GC of dead-branch rows (P5 storage policy): follow-up.
- The fork-point hash for child threads (the CP supplies the parent's hash at the fork seq):
  confirmed in the sub-agents slice.
- Where `history-summarised` renders relative to `anchor`: assembly, slice 2/3.
