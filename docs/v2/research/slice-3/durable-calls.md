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

## Draining instead of killing

`launchDaemon` used to SIGKILL a live daemon whose bundle hash differed, which killed its in-flight calls
with it. Now it asks the daemon to drain (`apps/agent-host/src/sandbox/daemon-launch.ts`):
- `POST /drain` on the daemon's port, `authorization: Bearer <token>`, body `{ "deadlineMs": n }`. The
  token is the same HMAC the host computes for the session and travels only in the command's environment,
  never in argv. Bad or missing token → `403`; already draining → `409`; accepted → `202 draining`. Every
  other request still answers `atlas-daemon`, so the listen probe is unaffected
  (`apps/daemon/src/transport.ts`).
- The daemon then waits for the calls this boot is executing (`ExecutingCalls.settled`), stops its
  listener and its groups, and exits 0 (`apps/daemon/src/index.ts`). New runs are not refused while
  draining: a session has one turn in flight and that turn is waiting on the call being drained; the
  deadline is the backstop.
- The host polls the listen probe every 250 ms until the port stops answering, with a budget of 600 s —
  bash's own cap, which is the longest a single call can run, so a legitimate call is never cut early. The
  turn is already blocked on that call, so the wait costs nothing the user was not already waiting for.
- Refusal or an expired budget falls back to `KILL_SCRIPT`. An older daemon does not know `/drain` and
  answers `200 atlas-daemon`, which is exactly the one-time transition: the first release shipping `drain`
  still kills the previous version's daemon once.

`apps/agent-host/src/__tests__/faults/f45-daemon-version-swap.fault.spec.ts` proves the whole path with
real processes: a gated bash, `daemon.drain()`, the gate released, the daemon exits on its own with no
signal and no orphan, a new daemon on the same home, and the done result collected exactly once with the
run count still one.

## The live check (2026-11-08)

Run on a real Vercel sandbox with `launchDaemon` driven directly instead of through the control plane: no
session, no Render and no model in the path. One sandbox, the daemon booted from a `0.1.0` bundle
(`sha256 d89af21693be…`), an `exec` of a 200 MB `bzip2` dispatched to it, then a second `launchDaemon` with a
`0.1.1` bundle (`58606726cf5a…`) while that call was still running. The second wake's log:

```
sandbox atlas-v2-45651576… runs daemon "d89af21693be…", needs "58606726cf5a…" — restarting it
sandbox atlas-v2-45651576… daemon is draining
sandbox atlas-v2-45651576… daemon drained
sandbox atlas-v2-45651576… has no matching daemon — booting it under the flock
sandbox atlas-v2-45651576… daemon is listening on 3000
```

That wake took 15.6 s: the drain waiting out the rest of the `bzip2`. The two clients, one per daemon:

| socket          | daemon                              | frames                                                                                                                                                                            |
| --------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| before the swap | `version 0.1.0`, bootId `1ec88394…` | `run-reply running`, then the output (`200889634\n`, `finished\n1\n`) and `result ok, exit 0, outputBytes 21` — the old daemon finished the call it had started, during the drain |
| after the swap  | `version 0.1.1`, bootId `1a8f0642…` | `answered k1 done`, `run-reply done`, `result ok, exit 0, outputBytes 21`, and the replayed output `200889634\nfinished\n1\n`                                                     |

The `1` is the command's own `wc -l < /tmp/swap-runs`, so the bash ran once, and the kill fallback never
fired (`killLines` empty). A version mismatch drained the old daemon instead of killing it, a running call
finished across the swap, and the next daemon served the stored result without re-running anything.

Seven earlier attempts went through the control plane with Render suspended and all seven were invalid. The
traps they exposed are worth keeping:
- a background subshell's `$!` is not the process unless the subshell `exec`s, so a "kill" can leave the old
  host alive to collect the call itself;
- `trap … EXIT` does not survive `SIGTERM`; a script that holds production suspended needs a `TERM` trap too;
- a session whose preparation never reached `workspace-prepared` stays claimable forever, so every host picks
  it up and retries it;
- `POST /resume` starts a Render build, and that build finishing mid-window spawns an instance that takes the
  session back, so absence must be re-verified _after_ the suspend;
- `POST /v1/services/{id}/scale` queues a deploy as well.

The driver was a gitignored scratch script (`apps/agent-host/.scratch/live-swap/swap-live.ts`, not kept, like
the earlier live-exit tests): it reads the operator's Vercel credential from the `UserVercelCredential` row,
builds both bundles from the same source with different `ATLAS_DAEMON_VERSION` defines, then runs the
sequence above and stops the sandbox.

## What stays interrupted

A daemon crash mid-call, a sandbox stop/restore, and a host that dies before the daemon finished: there is
no drain to wait for and the process is gone. A finished result survives; a running call is honestly lost.
