# Durable calls across a daemon boot (2026-11-08)

What PR 1 of [the daemon-version-swaps follow-up](../handoffs/daemon-version-swaps.md) changed, and why the
daemon's disk store is now the channel that carries a finished call from one daemon version to the next.

## The journal is the contract

`apps/daemon/src/disk-store.ts` keeps one directory per call under `<home>/calls/<runId.callId.ordinal>/`,
holding `state.json` and `output.bin`. Call keys are unique forever, so an entry written by any past daemon
can never collide with a new call.

`state.json` is now versioned (`packages/protocol/src/engine/call-store.ts`):

```
{ "format": 1, "state": "running", "epoch": 7, "op": {...}, "outputBytes": 0 }
{ "format": 1, "state": "done",    "epoch": 7, "op": {...}, "outputBytes": 812, "result": {...} }
```

`parseCallJournal` accepts exactly that and returns `undefined` for anything else (another format, a
truncated file, a `done` journal with no result), so the standing promise is narrow and checkable: **a
journal written by one daemon version is readable by the next**. A journal that cannot be read is treated
as absent, and the host falls back to its old rule.

## Pruning: age and bytes, never a wipe

`DiskCallStore.prune()` used to `rm -rf <home>/calls` on every boot, because nothing could read the files
back. It now keeps entries younger than an hour and within 256 MB of total output, removing oldest first
and always keeping the newest entry even when it alone exceeds the budget. `Ledger.open()` still calls it,
so a boot is housekeeping rather than a wipe. The memory store keeps its journals for the same reason (its
owner, a test daemon, defines the lifetime).

## Serving what the old daemon finished

`CallLedger.run` now consults `CallStore.readState` before it spawns anything for a key it does not know
(`packages/protocol/src/engine/ledger.ts`):
- a stored `done` journal: adopt it — no handler is needed, no op runs, the stored output is replayed from
  the requested offset and the stored result is answered;
- a stored `running` journal: the previous daemon died mid-call, so answer the call with
  `interrupted` — "interrupted by a daemon restart before its result was recorded; its effects are
  unknown — check before repeating it" — and rewrite the journal `done` with that result, so a second host
  gets the same answer until an ack removes it;
- a journal that exists but cannot be read: refuse the run (`internal`), rather than risk running a
  destructive op twice.

The adopted call reports the stored `outputBytes`, not what the adopting process wrote (nothing).

## Asking instead of assuming

The host used to decide "lost" from boot ids alone (`packages/host/src/calls/errors.ts`, row 5 in
[the slice 3 decisions](../../handoffs/slice-3-pr3/decisions.md)): a call dispatched on another boot id was
settled `interrupted` with nothing sent. That is why a daemon swap could never have collected anything.

Now a new frame pair lets the host ask first:
- host → daemon: `{ "kind": "answer", "key": "...", "epoch": n }`
- daemon → host: `{ "kind": "answered", "key": "...", "state": "done" | "running" | "never-seen" }`

The daemon answers from memory first (the live ledger is authoritative) and then from the store, without
spawning. The host feeds that answer into core's `recoverCall` (`variant: { doneRuns: true }`): `done` and
`running` mean "send the run and collect", `never-seen` keeps the old rule (read-only ops rerun, anything
else is interrupted), and a link that dies mid-ask counts as `never-seen`. The same path serves a host that
reconnects to a new daemon boot and a host that takes the session over from a dead one.

A `never-seen` answer is what keeps the safety property: a recreated sandbox (stop/restore) has no
journal, so a destructive call is still reported interrupted instead of silently re-run.

## Proof

- `packages/protocol/src/engine/__tests__/ledger-restart.spec.ts`: a stored `done` journal is served
  without running the op (no handler registered at all); a stored `running` journal answers interrupted and
  becomes done; an ack removes the entry so a later run executes again; an unreadable store refuses the
  run.
- The daemon conformance rows (`packages/protocol/src/testing/conformance/calls.ts`) run against both the
  in-memory and the real daemon: after `restart()` a finished call answers `done`, is served with its
  output and result, and adds no run; a call that was running answers `running`, then interrupted.
- `apps/agent-host/src/__tests__/faults/f44-daemon-restart-collects.fault.spec.ts`: a gated bash runs, the
  daemon writes the done journal while the result frame is held in the proxy, the daemon is killed and
  respawned on the same home, the old host is killed, and the next holder collects the done result exactly
  once with the run count still one.

## What stays interrupted

A daemon crash mid-call, a sandbox stop/restore, and a host that dies before the daemon finished: there is
no drain to wait for and the process is gone. PR 2 removes the remaining avoidable case, a version swap
that kills a healthy daemon.
