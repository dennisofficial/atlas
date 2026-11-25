# Handoff: Atlas v2 slice 3, continue from PR 2a

Written 2026-11-03 at the end of the session that wrote and approved the slice 3 spec. Everything
here is in the repository or on GitHub; nothing from that session's scratch survives.

## Where things stand

- **Merged:** #1718 (the spec, [slices/03-agent-host.md](../slices/03-agent-host.md), and the Render
  RTT write-up [research/d8/rtt-render.md](../research/d8/rtt-render.md)); #1735 (PR 1: call protocol
  in `packages/core/src/record/calls`, its exhaustive crash simulation, `OnceLedger`, the
  `HandoffPaused` rename, `packages/protocol`).
- **Draft:** [#1736](https://github.com/dennisofficial/atlas/pull/1736), branch `dennis/v2-daemon`
  (PR 2a: `packages/sandbox`, `apps/daemon`, the in-memory daemon and conformance suite). It has 13
  bugs and two spec deviations from an independent review:
  [research/slice-3/pr2a-review.md](../research/slice-3/pr2a-review.md). Do not merge it as is.
- The stale remote branch `dennis/v2-call-protocol` (pre-rebase PR 1) has no PR and can be deleted.

## The job, in order

1. **Fix #1736** against every row of the review. Write the failing conformance case first for each
   bug (both the real and the fake daemon must pass it), then fix. Also make the parallel-build seams
   clean (the review's "Parallel-build seams" section): an op group must be addable by touching only
   its own folder plus one registration line in the daemon, the protocol ops index, the fake and the
   conformance suite. Re-review independently, merge when CI is green.
2. **PR 2b, in parallel**, one builder per group, each in its own worktree and its own PR: background
   shells, services, MCP stdio relay, terminal, git-refs watch (spec point 7 table and point 11). Each
   builder owns its folders only. Start them only after step 1 merges.
3. **PR 3**: `packages/host` (`SessionHolder`, remote calls), `apps/agent-host`, the `v2.*` API
   namespace (create, list, post, events, status, `v2.agentHost.config`), `sessionsNeedingHolder`,
   `packages/jobs` and `apps/trigger` with `v2-reconcile-holders` (0022). Then create the Render service
   `atlas-agent-host` (Standard plan, 2 instances, Virginia, Comp AI workspace
   `tea-cvi2tf7noe9s73aqppe0`; Render's GitHub app already sees `dennisofficial/atlas`). The host must
   apply `recoverCall` row 5 before sending `run` after a changed `bootId` (the daemon spawns unknown
   keys immediately).
4. **PR 4**: the live exit tests, the fault matrix, docs (roadmap, architecture §5 for direct Postgres
   appends), and the slice 4 handoff.

## How the operator works (changed this session)

- **Merge v2 PRs without asking** when v1 is unaffected and v2 stays testable; verify independently
  first (a reviewer agent plus your own mutation checks found real bugs both times this session).
  Still ask before anything that changes v1 behaviour or creates production infrastructure in a new
  way (the Render service, the trigger.dev project, new secrets).
- He is tired of reading long reports: lead with what changed and what he must do, plain terms.
- Never force-push; when a rebase rewrites a pushed branch, push it under a new branch name.
- Secrets: `RENDER_API_KEY`, `VERCEL_TOKEN`, `TRIGGER_ACCESS_TOKEN` are exported to shells.

## Lessons from this session

- Builders tend to re-implement the pure rules inside tests and adapters instead of calling them.
  Check that the simulation and the daemon actually drive `stepCalls`/`recoverCall` (mutate the real
  function and watch a test fail).
- The 2-call exhaustive simulation takes ~56 s; daemon reboots are explored only for 1 call.
- `Bun.SQL` connects to PlanetScale without TLS; use `@dltech/atlas-db` (`pg`).
- Mutating code in a test loop can blow memory; restore with `git checkout -- <file>` and check
  `git status` after every mutation run.

## Suggested skills

`atlas` (services, secrets, Render/trigger setup), `codebase-design` (keep the daemon and host deep),
`tdd` (conformance case before fix), `code-review`, and `handoff` at the end.
