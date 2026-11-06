# 0026. v2 hosts pull sessions from the database; a held session is a scope that always settles

Proposed 2026-11-05. Amends [0025](0025-v2-connection-bound-leases.md) (the wake path and the ring scan
become doorbells, not the source of work) and the held-session loop in
[architecture §13](../v2/architecture.md). The epoch, the fence and connection-bound presence are
unchanged.

## Context

The slice 3 live tests and the [recovery audit](../v2/research/slice-3/recovery-audit.md) found sessions that got stuck on a live host. Three
fixes were merged: #1904 (every exit settles the lease), #1903 (a 20 s sweep plus an own-lease audit) and
#1908 (start failures are recorded and bounded). They work, but #1903 is a repair loop for states the
design lets happen. The states come from three choices:
1. **Work is announced, not stored as work.** A session is woken by a `pg_notify` and, after a reconnect or
   a host death, by one scan. A notification lost while a `LISTEN` connection reconnects is gone. The rows
   that say a session needs a holder (unconsumed inbox, `wantsHolder`, an absent holder) were always
   there, but nothing re-read them until the next event.
2. **Work is pushed to a host that may refuse it.** `SessionHolder.onWake`
   (`packages/host/src/holder/session-holder.ts`) returns without a trace when a claim for the session is
   pending, its start backoff is waiting, or the host is at `maxSessions`. Nothing offers the session again.
3. **Ownership lives in two places.** The lease row says "host 52 holds it"; `SessionHolder.held` and
   `HeldSession`'s flags (`released`, `failedToStart`, `faulted`, `lostOwnership`, `draining`) say
   whether host 52 is running it. Every exit path has to bring the row back in line by hand
   (`teardownHeldSession`, `releaseIdleAndRewake`, `releaseUnstarted`, `hold`'s early revoke), and
   each missed path was a stuck session (audit F-01, F-10, F-11, F-29). Start backoff
   (`start-backoff.ts`) is a third place: it lives in one host's memory, so another host ignores it and a
   restart forgets it.

A recovery path that runs only after a rare failure is untested in practice. The fix is to make the path
that recovers the same one that runs on every claim.

## Decision

**D1. The database is the work queue; hosts pull.** "This session needs a holder" stays one predicate
over rows (today's `sessionsNeedingHolder`, `packages/control/src/postgres/postgres-needing-holder.ts`,
plus the retry gate in D3). A host claims with one statement-level operation,
`plane.claimNext({ hostId, limit })`, that selects needing sessions with
`FOR UPDATE OF l SKIP LOCKED`, writes `epoch + 1, holderHostId = self, wantsHolder = false` on each, and
returns the leases. `limit` is the host's free slots, so a full host asks for nothing and nothing is
refused. Two hosts claiming at once never block each other or take the same session. The lease row is
created with the session (today it is created lazily by the first claim, `initialLease`,
`packages/control/src/lease-ops.ts:14`) so there is always a row to lock.

**D2. Notifications are doorbells.** Each host runs one claim loop: `claimNext`, hold what it returns,
sleep until a doorbell or the next tick (20 s ± 20 %, the interval Dennis approved for #1903). A
`pg_notify`, a `LISTEN` reconnect, the ring waiter returning, and a held session ending all ring the
doorbell. A lost doorbell costs at most one tick of latency, never a stuck session. The per-session
`claim(sessionId)` path and `onWake` for unheld sessions are deleted; a wake for a session the host
already holds still requests that session's reconciler (that is a held session reading its own inbox, not
claiming).

**D3. Retry state lives on the lease row.** Two columns, `attempts int` and `retryAfter timestamptz null`.
A start failure or a faulted loop increments `attempts` and sets `retryAfter = now + min(1 s · 2^attempts,
30 s)` in the same write that releases the lease; `claimNext` skips rows whose `retryAfter` is in the
future. A clean settle resets both. At the bound (5 for start failures, matching #1908; N for faults,
slice 6's crash-loop quarantine) the host appends the visible failure event and writes `wantsHolder =
false`, and the existing `inboxHead` rule makes the next message the retry. Every host honours the
backoff, it survives restarts, and the quarantine stops being a separate mechanism. `StartBackoff` is
deleted.

**D4. A held session is one scope.** `SessionHolder` runs each claimed lease through one function:

```ts
const outcome = await runHeld({ lease, ... })   // never throws
await settle({ lease, outcome })                // the only place a lease is released
```

`runHeld` returns an `EHeldOutcome` (`Idle`, `Faulted`, `StartFailed`, `Drained`, `Fenced`); every exception
inside it, including a fault out of the turn driver, becomes `Faulted`. `settle` is the single mapping from
outcome to lease write: `Fenced` writes nothing (the epoch already moved), every other outcome revokes at
the lease's epoch with `wantsHolder` from the same pure `needsHolder` fold the drain uses and the retry
columns from D3, and stops the runtime. The flags on `HeldSession` collapse into the outcome. A new exit
path cannot forget to release, because there is no release outside `settle`.

**D5. An unsettled settle is retried by the same loop.** `settle` can fail if the database is unreachable.
The host keeps the lease in a `settling` set and the claim loop retries `settle` for each entry before it
claims more; there is no separate audit. If the lock connection is lost meanwhile, presence frees every
lease anyway (0025). The own-lease audit from #1903 becomes a check that logs at error and settles: it
should never fire, and when it does it names a bug.

## What happens to the work merged on 2026-11-05

| PR                                                  | Becomes                                                  |
| --------------------------------------------------- | -------------------------------------------------------- |
| #1903 sweep                                         | The claim loop's tick. `HolderSweep` stays as the timer. |
| #1903 own-lease audit                               | A should-never-fire check feeding `settle` (D5).         |
| #1904 teardown branches, `HeldRelease` retry        | `settle` and the `settling` set (D4, D5).                |
| #1908 start failure event and status                | Unchanged; its in-memory count moves to `attempts` (D3). |
| `StartBackoff`, `releaseUnstarted`, `onWake` claims | Deleted.                                                 |
| #1899 daemon re-wake cap, ring waiter, `LISTEN`     | Unchanged (the ring and `LISTEN` ring the doorbell).     |

## Why

- The normal path and the recovery path are the same code. A host taking over after a crash, a host
  starting a new session and a host retrying a failed start all run `claimNext` → `runHeld` → `settle`,
  which runs thousands of times a day.
- `FOR UPDATE SKIP LOCKED` is the standard Postgres job-queue pattern; it needs no coordinator and no
  leader. The lease row keeps doing what 0025 built it for (epoch fence, presence-bound liveness).
- Cost: one `claimNext` per host per tick. It reads `pg_locks` like today's `sessionsNeedingHolder`; 0025
  measured that read at a few ms with 3,000 locks, which is fine at one call per 20 s and stays off the
  append path.

**Rejected:** keeping push wakes and adding more repair loops (the current state; each new failure needs a
new repair); a central scheduler that assigns sessions to hosts (a leader to elect and keep alive, for
what `SKIP LOCKED` gives for free); per-session timers on the lease row (renewal, which 0025 removed).

## Proof (each a spec that fails on today's code)

- Two hosts call `claimNext` concurrently against Postgres 100 times: no session is claimed twice, no call
  waits on the other.
- A full host (`maxSessions` reached) with a second session pending: the session is held as soon as a slot
  frees, with no post and no wake (F34 today passes only through the sweep).
- A wake dropped on the floor (no `NOTIFY` delivered): held within one tick.
- A start failure on host A, then host B: B does not claim before `retryAfter`; after 5 failures across
  both hosts the failure event is recorded once.
- A loop fault, a failed settle (revoke throws twice), and a drain: each ends with the lease released and
  the next message answered (F28, F29).
- The existing fault matrix F1–F27 passes unchanged.

## Build plan (each a reviewable PR)

1. Lease row with the session; `attempts` and `retryAfter` columns; `claimNext` in `ControlPlane`, both
   stores and the conformance suite (the concurrency spec above runs on the Postgres lane).
2. The claim loop in `SessionHolder`: doorbell plus tick, `limit` = free slots; delete per-session claims,
   `onWake` claiming and `StartBackoff`.
3. `runHeld` and `settle`: the `EHeldOutcome` enum, the `settling` set, retry columns written on release;
   collapse `HeldSession`'s flags and the teardown helpers in `held-idle.ts`/`held-release.ts`.
4. Fault rows for the proofs above; update architecture §13 and 0025's wake-path text.
