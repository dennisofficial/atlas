# 0023. v2 leases are held by the host's Postgres connection, not renewed

Proposed 2026-11-05; accepted when the operator merges the PR that adds it. Replaces the TTL and
renewal mechanics of P4 and R4 in [architecture §13](../v2/architecture.md) and amends
[0021](0021-v2-loop-runs-on-the-agent-host.md) (the agent host "renews the lease on its own timer"
and the reconcile task is "the safety net for a crashed holder"). The epoch, the fence and the
wake path are unchanged.

## Context

A holder lease today is `{epoch, holderId, renewedAt, ttlMs, wantsHolder}`. It is live while
`now < renewedAt + ttlMs` (`packages/core/src/record/lease.ts`). Three things tick to keep that true:
- Every held session renews every 5 s with a 30 s TTL (`packages/host/src/holder/lease-renewal.ts`),
  plus a fence watchdog per session. 23 sessions in one minute is 23 renew writes every 5 s forever,
  each a transaction that locks and rewrites the lease row.
- A trigger.dev task runs every minute and wakes sessions whose lease expired
  (`apps/trigger/src/reconcile/reconcile-holders.ts`), because a crashed holder emits no event.
- A crash is noticed after up to one TTL plus up to one reconcile period.

The operator asked on 2026-11-05 for leases held by the host's Postgres connection, with no renewals
and no polling, and a design that scales.

Measured in the production spike on 2026-11-05 (PlanetScale, direct port 5432):
- A holder SIGKILLed while holding `pg_advisory_lock` frees it for another connection in
  **106–107 ms**: the OS closes the socket and the server releases the session's locks.
- A machine death or partition is not covered by that. Server keepalives default to 7200/75/9 s
  (about 2 h). A connection can `SET tcp_keepalives_idle=5, tcp_keepalives_interval=2,
  tcp_keepalives_count=3` for about 11 s.
- `max_connections` is 50 and `max_locks_per_transaction` is 64, so the shared lock table holds about
  3,200 locks for the whole cluster. Dennis's peak is 23 active sessions in a minute.

The brief that started this record proposed one advisory lock per session, a liveness check on
`pg_locks` inside every append, and one blocked waiter connection per peer host. Measuring and
reading those three parts against the numbers above changed the design.

## Decision

**D1. A lease is live while its holder host's presence lock is held. There is one lock per host, not
one per session.**
- A host registers once: `nextval` gives it an id, its dedicated *lock connection* runs
  `pg_try_advisory_lock(PRESENCE_NAMESPACE, id)`, and only then does it insert a `V2Host` row. A row
  therefore never exists without its lock having been taken.
- The lease row becomes `{sessionId, epoch, holderHostId, wantsHolder}`. `renewedAt` and `ttlMs` go.
- A lease is live iff `holderHostId` is set and `pg_locks` shows an *exclusive* advisory lock granted
  on `(PRESENCE_NAMESPACE, holderHostId)`. Shared mode is excluded on purpose: peers watch with shared
  locks (D5), and a watcher must not make a dead host look alive.
- One lock covers every session the host holds. Losing the lock connection releases all of them at once,
  which is the failure the host has to handle anyway.

**D2. The epoch is the fence. The lock is only liveness.**
- An append checks what it checks today: the lease row's `epoch` equals the writer's and
  `holderHostId` is set. It does not read `pg_locks`.
- The append transaction reads the lease row `FOR SHARE`, and a claim takes it `FOR NO KEY UPDATE`,
  so an append already in flight finishes before the epoch moves and every later append sees the new
  epoch. Today the append reads the lease without a row lock.
- A claim runs in one transaction: lock the lease row, refuse with `held` if the current holder's
  presence lock is granted, refuse with `not-present` if the claimer's own is not, then write
  `epoch + 1` and the new holder. The claimer's own check is what stops a host whose lock connection
  silently died from claiming sessions it cannot hold.
- `isLive` leaves `core`, which cannot query. `claim` takes `holderPresent` and `selfPresent` as
  inputs from the control package, and `acceptAppend` loses `now` and the `lease-expired` refusal.

**D3. The lock connection is direct, dedicated and short-lived.**
- It uses `DATABASE_DIRECT_URL`, as the wake listener does. A session-level lock behind PgBouncer's
  transaction mode would outlive the client that took it, so a pooler URL is refused at startup.
- It sets `tcp_keepalives_idle=5`, `tcp_keepalives_interval=2`, `tcp_keepalives_count=3`, and
  `statement_timeout=0`, `idle_session_timeout=0` and `idle_in_transaction_session_timeout=0` for the
  connection. The client opens it with `keepAlive: true`.
- A lock connection that errors or ends is not repaired in place. The host stops appending, pauses every
  loop, ends its pool connections' use of the old identity, and registers a **new** host id. Its
  sessions come back through the normal claim at the next epoch and resume from the record. Only an
  in-flight model stream is lost, as in a deploy handoff (0021).
- If an append fails on transport (connect error, timeout) past its retry deadline, the host closes its
  lock connection on purpose. Its ability to hold leases and its ability to write are then the same
  fact, and a host that can reach Postgres on the lock connection but not on the pool cannot sit on
  sessions nobody can claim.

**D4. Release is a row write.** Idle release and drain call the existing revoke
(`holderHostId = null`, `epoch + 1`, `wantsHolder`, `pg_notify` when work remains). There is nothing to
unlock. Clean stop deletes the `V2Host` row and closes the lock connection.

**D5. Hosts watch each other in a ring, with one waiter connection each.**
- Hosts are ordered by `V2Host.id`. Each host keeps one connection blocked in
  `pg_advisory_lock_shared(PRESENCE_NAMESPACE, successorId)`, where the successor is the next
  registered host, wrapping. Shared mode lets any number of watchers wake together instead of one at a
  time.
- A host alone in the ring has no successor and starts no waiter; only the start-up scan covers it.
- The waiter holds nothing else, so it cannot take part in a lock cycle. It sets `statement_timeout=0`
  and `lock_timeout=0`.
- When the wait returns, the peer's connection is gone. The waiter releases the lock, deletes the
  successor's `V2Host` row, runs the global scan (below), sends one `pg_notify` per session found, and
  re-targets its new successor. The scan is global rather than the dead host's sessions only, so a
  waker that dies half-way leaves nothing behind that its own watcher's scan will not find. The
  ordinary claim race, bounded by each host's `maxSessions`, places the sessions. If the next host is
  also dead, the wait returns at once and the ring keeps walking.
- A host joining or leaving sends `pg_notify` on `atlas_host_change`; every host recomputes its successor.
  A waiter whose connection drops reconnects, and the first thing the new wait does is return at once if
  the peer died in the gap.
- On start a host runs one global scan, "sessions needing a holder whose holder is not present". That
  covers a fleet that was entirely down, a single-host fleet, and any session whose predecessor died
  with it.
- This replaces `reconcile-holders` and the ttl arithmetic in `sessionsNeedingHolder`. The query stays,
  with `NOT present(holderHostId)` in place of the expiry test.

## Why

**Per-session locks buy nothing the epoch does not already give.** Mutual exclusion on a claim comes
from the lease row lock and the epoch compare, which exist today. The per-session lock would add one
slot per held session to a lock table of about 3,200 that the whole cluster shares, and one more
fact to keep in step with the row. One lock per host needs one slot per host.

**`pg_locks` is not cheap enough for the append path.** Measured on Postgres 17.11 (the test lane
on port 55441, 4 cores, unix socket), one append transaction (`SELECT epoch ... FOR SHARE`,
`UPDATE` head, `INSERT` a 200-byte event) over 4,000 sessions, while another connection holds N
advisory locks. The extra statement is `SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND
granted AND classid=0 AND objid=$k AND objsubid=1`. One 8 s run per cell.

| Locks held | Clients | Epoch check only | Plus `pg_locks` | Plus `pg_try_advisory_xact_lock_shared` |
| ---------: | ------: | ---------------: | --------------: | --------------------------------------: |
|         23 |       1 |          0.33 ms |         0.65 ms |                                 0.59 ms |
|         23 |       8 |          1.66 ms |         1.97 ms |                                 1.79 ms |
|        600 |       1 |          0.28 ms |         0.86 ms |                                 0.40 ms |
|        600 |       8 |          0.83 ms |         2.56 ms |                                 1.10 ms |
|      3,000 |       1 |          0.28 ms |         2.00 ms |                                 0.31 ms |
|      3,000 |       8 |          0.59 ms |         5.22 ms |                                 0.99 ms |

At 3,000 locks and 8 clients the `pg_locks` check cut throughput from 13.6k to 1.5k transactions per
second (8.9× the latency). The cost grows with the number of locks in the whole cluster, not with
what the append touches, because the view materialises the entire lock table. It also reads every lock
manager partition, so it slows unrelated backends. (That is how `pg_lock_status` is implemented, and
the scaling above is consistent with it; I did not profile it.) The first row's 8-client baseline ran
first and carries warm-up, so read the 23-lock rows as "about +0.3 ms", not as a ratio. Local numbers
exclude the network: the extra statement is also one more round trip per append against PlanetScale
unless it is folded into the append's own query.

The shared-lock `try` variant is the cheap way to ask "does anyone hold this?" (+0.4 ms at 3,000
locks), but it only exists if every session has its own lock.

With D1 the same query reads about 10 rows. It runs on a claim, on status reads and on the scan, never
per append. The needing-holder scan over 4,000 leases with four presence locks held took 0.33 ms.

**A waiter per peer does not scale on this Postgres.** With N hosts and one waiter per peer the fleet
holds N(N−1) blocked backends. At 8 hosts that is 56, above `max_connections` 50, and each is a
server process. The ring needs N, constant per host: pool, `LISTEN`, lock, one waiter. An elected
watcher needs 2(N−1) and a failover protocol for the watcher; the ring has none, because every host
is some host's watcher.

**Epoch alone is the right fence; the lock cannot be one.** A lock is held by a connection, not by the
caller that made the write. A zombie whose lock connection died keeps a pool that still reaches
Postgres, and an advisory lock is not replicated, so a failover leaves the new primary with no locks
at all. Only a value in the row, written in the same transaction as the append and compared there,
survives both. The lock's job is to say when a claim is allowed.

**It makes the zombie window small without a timer.**
- Tools are dispatched only after `tool-dispatched` is appended and dispatch fails closed
  (0021), so a host that cannot append cannot start work.
- A sandbox daemon refuses a stale epoch at hello (`StaleEpoch`,
  `packages/protocol/src/engine/daemon-engine.ts`).
- Server keepalives free a dead host's lock in about 11 s, and the next claim bumps the epoch.

## Failure cases

| Case | What happens |
| --- | --- |
| Holder process SIGKILL | The OS closes the socket, the server frees the presence lock in about 0.1 s, the successor's waiter returns, its sessions are woken and claimed. |
| Machine death or partition | The server's keepalives free the lock in about 11 s; same path. The zombie, if it comes back, is refused by epoch. |
| Lock connection dead, pool alive | The host sees `error`/`end` at once, or the next append is refused. It stops, registers a new id and reclaims. Another host may claim first; the epoch refuses the old holder. |
| Lock connection alive, pool dead | Appends fail on transport past their deadline; the host closes its lock connection (D3). Peers claim within the keepalive window at most. |
| Two hosts race a claim | The lease row lock orders them. The second sees the first's presence lock granted and gets `held`. |
| Deploy drain | Unchanged: revoke the sessions that have work with `pg_notify`, release the idle ones, close the lock connection last. |
| PlanetScale failover | Every connection drops and the new primary has no advisory locks. Each host reads that as lock loss, registers a new id, and reclaims its sessions at the next epoch. The `V2Host` rows of the old ids are deleted by the first waiter that finds them free. Epoch fencing is as durable as the database; if an old primary stayed writable the design would have no protection, and neither would the TTL design. |
| PgBouncer (transaction mode) | Refused at startup for the lock connection. Waiter connections follow the same rule. The API's pooled URL is unaffected. |
| Every host down, then one starts | The start-up scan lists sessions whose holder is not present. |
| Waiter connection drops | It reconnects and waits again; a death in the gap makes the wait return at once. |

## Consequences

- **Measure first.** Two facts are assumed from the spike or from documentation and must be checked in
  the first build PR against the real PlanetScale role: that `SET tcp_keepalives_*` is permitted, and
  that `idle_session_timeout` is off for it. A role that reaps idle sessions would kill the lock
  connection every few minutes.
- Removed: `LeaseRenewal`, `ttlMs`, `renewEveryMs`, `fenceMarginMs`, the `lease-expired` refusal,
  `renew`, the `reconcile-holders` task and its spec, the expiry arithmetic in
  `sessionsNeedingHolder`.
- Kept: epoch, `wantsHolder`, `pg_notify` wakes, the resync on `LISTEN` reconnect, and
  `appendDeadline`'s retry limit (it is a retry deadline on an append, not a timer).
- Connections per host: the pool, plus three. The lock table holds one lock per host and one shared
  lock per watcher, briefly. The 3,200-lock ceiling no longer bounds sessions.
- A kernel keepalive probe on three connections per host is transport, not application, activity.
  Application code starts no timer to look for work or to prove liveness.
- A lock connection blip costs every session on that host an in-flight model stream and a claim. The
  alternative, re-taking the same key and re-checking epochs in place, saves that, but the old backend
  can still hold the key for up to 11 s after the client sees the error, so the host would have to wait
  for it. It is not taken.
- Clients that read lease liveness (status, `currentLease`) read `pg_locks` on the primary. A replica
  shows its own locks, so these reads never go to one.
- Nothing is built by this record. The build plan is in architecture §13.
