# Handoff: Atlas v2 slice 3, continue from PR 3

Written 2026-11-03 at the end of the session that fixed PR 2a and built PR 2b. Everything here is in
the repository or on GitHub.

## Where things stand

- **Merged:** #1718 (spec, [slices/03-agent-host.md](../slices/03-agent-host.md)); #1735 (PR 1: call
  protocol in `packages/core/src/record/calls`); #1736 (PR 2a: `packages/sandbox`, `apps/daemon`, the
  shared call engine); #1745 (`ManagedProcess` optional stdin, `DaemonOpsDeps.home`); PR 2b op groups
  #1749 mcp (+#1753), #1751 services, #1752 terminal, #1754 shells, #1756 git refs (main at 798e960b8).
- The daemon is complete for slice 3: every op group in spec point 7 is implemented, registered, and
  passes one conformance suite against the fake (`packages/protocol/src/testing`), the real daemon from
  source, and the built bundle (`apps/daemon`, `bun run build && bun run test`).
- Next is **PR 3**, then PR 4 (handoff [slice-3-pr2.md](slice-3-pr2.md) "The job", steps 3 and 4).

## How the daemon is built (read the code, not this)

- One engine, two adapters: the call ledger, epoch fencing and ordered output live once in
  `packages/protocol/src/engine` (`@dltech/atlas-protocol/engine`) and drive core `stepCalls`; the real
  daemon (`apps/daemon/src`) and the in-memory fake (`packages/protocol/src/testing/fake-daemon.ts`) only
  supply a store, a transport and op groups. This deliberately moves spec point 6's "call ledger in
  `apps/daemon/src/calls`" into protocol. For PR 3, host tests should use `createInMemoryDaemon` from
  `@dltech/atlas-protocol/testing`, and the real daemon via `apps/daemon/src/testing.ts`.
- Frames: `packages/protocol/src/frames.ts`. Per-op results are `{ status: ok, op, value }` or
  `{ status: failed, op, error: { code: ECallFailure } }`. `run` takes `fromOffset` to reattach; `ack`
  answers `acked`; `pong` carries `runs`; `health` carries the boot protection report. Long-lived groups
  (shells, services, mcp, terminal, git) publish `event` frames only to the current holder and expose a
  read op for anything the host must not miss.
- Core rules added this session: `hello` below the highest epoch is refused; `cancel` and `abandon` are
  `stepCalls` inputs.
- The daemon refuses to start without `V2_DAEMON_SECRET` and `ATLAS_SANDBOX_NAME`, deletes the secret
  from its env, and applies cgroup and oom protection itself on every boot (`ATLAS_DAEMON_CGROUP_ROOT`
  overrides the root for tests; `ATLAS_RG_PATH` points grep at rg, which tests take from `@vscode/ripgrep`
  because the CI runner has none).

## PR 3, what it must do

Spec points 2, 3, 5, 6 (remote calls), 9, 13; scope in [slice-3-pr2.md](slice-3-pr2.md) step 3.
Points the spec leaves to the builder, now settled by PR 2:
- Before sending `run` to a daemon whose `bootId` differs from the call's `tool-dispatched` bootId,
  apply `recoverCall` row 5: the daemon spawns any unknown key immediately.
- After hello, collect every open key with `run` (+ `fromOffset` for the same holder), then `ack` only
  after the `tool-result` commits. Handle `failed` results with `output-lost` / `persist-failed` /
  `cancelled` codes as typed tool failures.
- After reconnect, call `shells.list` / `services.list` / `mcp.read` / `terminal.read` /
  `git.read` as needed; events are only wake-ups.

## Waiting on the operator (ask, do not assume)

Dennis has not yet answered these; they gate the deploy, not the local build:
1. Create the Render service `atlas-agent-host` (Standard, 2 instances, Virginia, Comp AI workspace
   `tea-cvi2tf7noe9s73aqppe0`; Render's GitHub app already sees `dennisofficial/atlas`).
2. New secrets `V2_DAEMON_SECRET` (generated) and `V2_USER_IDS` (his user id).
3. A new trigger.dev project for `apps/trigger` (spec point 3 says its own project) with the
   `v2-reconcile-holders` task.
   Secrets `RENDER_API_KEY`, `VERCEL_TOKEN`, `TRIGGER_ACCESS_TOKEN` are exported to shells.

## Known follow-ups (not blocking)

- A cancel entry for a key abandoned during a takeover stays in `CallLedger.cancelledThrough` until the
  daemon restarts (`packages/protocol/src/engine/ledger.ts`).
- `packages/sandbox` still depends on `@dltech/atlas-wire` (needs `mirrorsThreadState`).
- Live cgroup/OOM test is gated on `ATLAS_LIVE_SANDBOX=1` and has never run in a real sandbox.
- Stale remote branches can be deleted: `dennis/v2-call-protocol`, `dennis/v2-daemon`,
  `dennis/v2-shells`, `dennis/v2-git`, `dennis/v2-terminal`, `dennis/v2-terminal-r2`,
  `dennis/v2-shells-r1`, `dennis/v2-git-r1`, `dennis/v2-mcp`, `dennis/v2-services`,
  `dennis/v2-managed-input`, `dennis/v2-mcp-conformance-split`.

## How the operator works

- Merge v2 PRs without asking when v1 is unaffected; verify independently first. Reviewer agents
  found real bugs in every round this session (three rounds on PR 2a), and own mutation checks found
  tests that were too weak. Do both.
- Ask before anything that creates production infrastructure or new secrets.
- Short reports: what changed, what he must do. Never force-push.
- He asked to rotate this session because of context size; rotate the next one before ~300k tokens.

## Lessons from this session

- Builders write conformance files over the 300-line cap; check line counts and split into
  `<group>-support.ts`.
- Builders that have pushed a green PR sit in CI-poll loops for a long time. Tell them to stop
  after opening the PR and report, and do merges and main-merges yourself.
- Parallel PRs all conflict in the four registration files (`packages/protocol/src/ops/index.ts`,
  `apps/daemon/src/ops/index.ts`, `packages/protocol/src/testing/fake/index.ts`,
  `packages/protocol/src/testing/conformance/suite.ts`). Resolve by merging `origin/main` into the
  branch (keep both sides), never rebasing a pushed branch.
- Reviewers that are "observe only" cannot run mutations; do mutation checks yourself with a backup
  and restore (`cp` / `git checkout --`) and check `git status` after.
- The core simulation takes ~80 s (`cd packages/core && bun test src/record/calls`).

## Suggested skills

`atlas` (services.yaml, secrets, Render/trigger setup), `codebase-design` (keep `packages/host` deep:
`SessionHolder` and remote calls), `tdd` (fault cases before fixes), `code-review`, and `handoff` at the
end.
