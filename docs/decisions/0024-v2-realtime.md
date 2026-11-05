# 0024. v2 real-time: a WebSocket stream service fed by NOTIFY pointers and read by seq

Proposed 2026-11-05; accepted when the operator merges the PR that adds it. Full design:
[slices/05-realtime.md](../v2/slices/05-realtime.md). Refines the client ⇄ CP row of
[architecture §5](../v2/architecture.md) (which says "tRPC plus SSE").

## Context

v2 clients must follow a session live with no polling. Vercel functions cannot hold WebSockets and
cap SSE at about 240 s. The record is an append-only, hash-chained log per thread keyed by `seq`,
written only through the `control` library; token-level output is not in Postgres but is published
as lossy frames to Redis. Production Postgres has `wal_level=logical`, so logical replication is
available. The operator's `pgbase` is the WAL-based reference.

## Decision

- **Change source:** the control library announces `{sessionId, threadId, headSeq}` with
  `pg_notify` inside the append transaction (and `{sessionId}` for session, inbox and lease
  changes). Readers read `seq > cursor`. Logical replication is not used. A `ChangeFeed` seam keeps
  it adoptable.
- **Service:** `apps/stream`, a Render Web Service, stateless, at least two instances. Not the agent
  host (a Background Worker with no ingress and a different deploy and failure profile), not the
  Vercel API.
- **Transport and contract:** one WebSocket per client multiplexing `session` and `sessions`
  subscriptions; resume by `(seq, hash)`; commands stay tRPC mutations into the inbox. Live frames
  are an ephemeral overlay and never required for correctness. Token streaming is a separate
  channel from the durable log: the agent host publishes batched, offset-keyed text deltas to Redis
  with a step buffer a joining node snapshots; the durable `assistant-said` replaces the overlay.
- **Auth:** bearer token in the first frame, verified against `AuthSession` in Postgres and
  re-checked on a timer; ownership per subscription.

## Why

- A log needs a cursor, not a row stream. Seq plus the hash chain gives exact resumption; WAL gives
  none and pgbase answers every doubt with a refetch.
- NOTIFY is transactional, already used for wakes, and has no retention to pin. A logical slot on the
  production database can fill its disk if a consumer stalls and makes every deploy a leader handover.
- WAL would still need a fan-out layer to other nodes, and cannot see lease liveness, which is not a
  row.
- The pointer works over the in-memory store and the SQLite control plane (D2); WAL does not.

## Consequences

- **One-way part:** the client wire protocol and the separate service. Apps in the wild speak it, so
  it is versioned from `hello` (0017) and clients ignore unknown messages. The change source is
  internal behind `ChangeFeed` and can change without a protocol change.
- Replaces "SSE" in architecture §5 with a WebSocket for the session and sidebar streams; the
  direct client ⇄ pod socket for ephemeral data is unchanged.
- Adds a Render service, one direct Postgres connection per node for `LISTEN`, and a read pool.
  `max_connections` (50) needs attention.
- `NOTIFY` serializes notifying commits on a database-wide lock and drops notifications across a
  listener disconnect. The first is benchmarked in the first PR; the second is handled by
  re-reading every subscription from its cursor.
- Revisit WAL if a live view needs predicates over rows not written through `control`, if the
  benchmark shows the commit cost matters, or if views span users.
- Lease transitions and the death scan of connection-bound leases must announce (section 27's design
  owns the lease change).
