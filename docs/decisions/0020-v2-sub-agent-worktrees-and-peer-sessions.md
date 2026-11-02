# 0020. v2 sub-agents carry the worktree tools; peer sessions replace nested teammates

Proposed 2026-11-02; accepted when the operator merges the PR that adds it. Amends the crew plugin
of [0019](0019-v2-package-map.md) and settles the "sub-agent families" risk in
[docs/v2/architecture.md §10](../v2/architecture.md#10-risks).

## Context

In v1 a sub-agent cannot change its working directory: `SUB_AGENT_DENIED`
(`packages/harness/src/agents/registry/child-runner.ts`) stripped `enter_worktree`,
`exit_worktree` and `worktree_list`, so a parent could not hand a builder a separate branch.

Teammates can, but a teammate is a session-sized thing built on a thread of its parent's session.
Every session-level feature has had to become thread-aware for it: GitHub tracking keeps
per-thread directory, home and worktree maps and re-probes git at turn start, after worktree tool
results and at turn end (`packages/harness/src/plugins/github/tracking.ts:37-52`); the cloud's PR
display follows the main thread only (`tracking.ts:59-66`). The operator finds teammates hard to
orchestrate and the nesting, PR and CI handling hard to maintain.

## Decision

**1. A sub-agent carries `enter_worktree`, `exit_worktree` and `worktree_list` and may move
itself.** The tools claim and move per thread, so a sub-agent's move changes only its own project
directory, never its parent's. `agent_spawn` may also take an optional `worktree` (a new branch name
or an existing worktree path) that the pod creates or adopts before the child's first turn. A
sub-agent that ends inside a worktree leaves it on disk for the parent, who needs the branch.

**2. Sub-agents do not subscribe.** A sub-agent builds, commits on its branch, and reports what it
did when it ends. The parent opens the pull request and owns its CI subscription. `subscribe` is on
the sub-agent denied list; the worktree tools are not.

**3. Checkouts are a session view, not per-thread tracking.** Placement is an event:
`checkout-placed { threadId, directory, branch, worktree? }` and `checkout-left`, logged by the pod
at session start, at a spawn into a worktree, on any thread's `enter_worktree` / `exit_worktree`, and
when a branch change is detected. The checkout set is a pure fold in `core` (slice 4), because more
than one plugin reads it. The github plugin derives its `(repo, branch)` targets from that view and
joins PR state from the CP observation store onto it. The sidebar shows every checkout of the
session, main's and its sub-agents', as the session's own; it does not nest them under the child.

**4. Peer sessions replace nested teammates.** A sessions plugin gives the agent `spawn_session`,
`message_session` and `list_sessions`. Its commands run in the control plane, which creates
sessions. A spawned session is an ordinary session with a `spawned-by` link, so it gets its own
worktree, PR and CI tracking with no thread machinery. `message_session` is a durable inbox entry
that wakes an idle session.

## Why

- A worktree entered through the tools is known from the event that creates it, so nothing probes a
  moving directory. Probing stays only as the fallback for a mid-turn `git checkout -b`.
- Keeping the PR and CI with the parent matches how sub-agents are used: they end when their task
  does and cannot wait on CI.
- With teammates gone, sub-agents are the only multi-log case under one lease, and they own no PR or
  CI. That is the smallest version of the families risk.
- The session becomes the only unit that owns a worktree's PR, CI and sidebar entry; GitHub never
  asks which thread is where.

## Consequences

- The sub-agents (crew) plugin spec covers the `worktree` spawn argument, who removes a
  worktree when the child ends (the parent, never the child; the child leaves it on disk), and the report a sub-agent sends.
- The sessions plugin needs a per-session message budget, so two agents messaging each other cannot
  loop without limit, and accepts that each peer session is its own sandbox (boot time and cost).
- **Open:** whether the teammate workflow survives as a preset over `spawn_session` (a peer
  session with its own worktree that reports back to its spawner, grouped under it in the sidebar
  as a view) or as a toggle on the v1 thread machinery. The preset is recommended: a toggle keeps
  every thread-aware path alive. Decided in the sessions plugin spec.
