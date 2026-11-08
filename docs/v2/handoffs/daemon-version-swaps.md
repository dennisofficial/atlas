# Handoff: daemon version swaps

Written 2026-11-08, after the command-robustness session. Follow-up the operator approved: make a daemon
version swap invisible — the old daemon drains, the running bash finishes, the next daemon serves its
result, and the user sees the turn carry on.

## Where things stand

Merged before this work: #2015 command re-run on takeover, #2017 unknown commands kept, #2011 refusals from
the log, #2012 view-cost measurement, #2016 edge deadlines, #2019 progress watchdog, #2018 main repair,
#2020 docs, #2021 the plugin contract, #2022 the github plugin.

**Correction to the earlier record.** `docs/v2/research/slice-3/hard-host-kill.md` used to read the
interrupted result of its SIGKILL run as "a deliberate difference from F11". It was not. Render's log of
that window shows `runs daemon "8a169b5c…", needs "9b5222a3…" — restarting it`: the local host ran a daemon
bundle built from a different commit, `launchDaemon` replaced the daemon, and the running bash died with
it. That is the version-_mismatch_ case, and it is the premise of this work. A same-version takeover is
expected to keep the daemon (`apps/agent-host/src/sandbox/daemon-launch.ts:91-95`) but had not been
observed live; a rerun must gate on Render being absent (its log printing `draining` and
`GET /services/{id}/instances` staying `[]` for 30–60 s) and on host A's log showing `holder.takeover`
before anything is killed.

## Design

Two PRs, the first lands alone.

**PR 1 — the store survives a daemon boot.** A call's journal (`state.json` + `output.bin`, keyed by
`runId.callId.ordinal`, unique forever) stops being wiped at boot and gains an explicit `format: 1`. The
ledger answers for a key it does not hold in memory from the store, serves a stored `done` result instead
of re-running, and answers "interrupted by a daemon restart" for a stored `running` one. The host asks the
daemon what it knows (a new `answer`/`answered` frame pair) before it applies the boot-id rule that used to
declare the call lost. Record: `docs/v2/research/slice-3/durable-calls.md`.

**PR 2 — drain instead of kill on a version mismatch.** `launchDaemon` sends an authenticated
`POST /drain` to a live daemon whose bundle hash differs, waits for the port to close (deadline = the
longest single call, 600 s, bash's cap), then boots the new daemon. It falls back to `KILL_SCRIPT` when the
old daemon refuses (an older version answers `200 atlas-daemon`, not `202 draining`) or the deadline
passes. One-time transition: the first release shipping `drain` still kills the previous version's daemon
once.

Deliberately not built: handing a live process to the next daemon (pid/tty/exit across versions), dual
daemons on one port, an old→new proxy. The disk store plays the role of "send the result to the next
daemon"; concurrency buys nothing because a session has one turn in flight and that turn is waiting on the
old call.

Stays `interrupted` on purpose: a daemon crash or a sandbox stop/restore has no drain to wait for and the
processes are gone. Finished results survive; a running call is honestly lost.

## Gotchas that cost time

- Build the daemon from the **same commit** the Render service runs before any live comparison
  (`apps/daemon/bin/daemon.js`; `bun run --cwd apps/daemon build`). Different commits → different hash →
  `launchDaemon` restarts it.
- `POST /suspend` on Render _pauses_ the instance (no `draining`, lease epoch unchanged) and cancels a
  deploy in flight; `POST /resume` starts a fresh build, so production is the better part of five minutes
  without an instance. Always resume in a `finally`.
- The fault rig needs real Postgres and Redis: `bun run --cwd packages/db db:test:up` and
  `docker compose -f apps/api/docker-compose.yml up -d --wait test-redis`, then
  `ATLAS_FAULT_TESTS=1 ATLAS_TEST_REDIS_URL=redis://127.0.0.1:55442`.
- The fault proxy's direction names are from the host's point of view: `holdUpstream` holds host→daemon,
  `holdDownstream` holds daemon→host. To keep a result out of the record, hold downstream.
- Tests: `(ulimit -v 4000000; bun test …)` inside one package. Typecheck root OOMs; use
  `bunx turbo run typecheck --concurrency=1`.
- Prod live runs: mint an `AuthSession` row for the operator's user id, drive the API with
  `createApiClient` from `packages/api-router/src/client`, then delete the row and archive the session.
  Never touch another user's rows.
- `bun test` in a fresh worktree needs `bun install` first, or every file errors in 15 ms.
- Biome: `bunx biome format --write` on new markdown files, or `bun run lint` fails CI.

## Status

- PR 1 (#2028, `30b42910c`): journal format, prune by age and bytes, ledger fallback, `answer`/`answered`,
  host collection, fault row F44. Recorded in `durable-calls.md`.
- PR 2: `POST /drain`, `DaemonEngine.drain`, drain-then-boot with the kill fallback, fault row F45. The
  `durable-calls.md` "Draining instead of killing" section is the contract.
- Live check done (2026-11-08): a real Vercel sandbox, daemon `0.1.0` → `0.1.1` while a 200 MB `bzip2` ran;
  the old daemon drained, finished the call, exited, and the new daemon served the stored result with the run
  count still one. Transcript in `durable-calls.md` ("The live check").
