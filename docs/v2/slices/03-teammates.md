# Design: teammates as parallel sessions

Status: **design, 2026-11-02.** This is a design section, not a slice spec — the filename number
is the next free one in this directory and does not name a roadmap slice. The specs for slices 3,
4 and 7 apply it. Sibling to [roadmap.md](../roadmap.md). Applies
[architecture.md](../architecture.md) §6 and
[0020](../../decisions/0020-v2-sub-agent-worktrees-and-peer-sessions.md) ("peer sessions replace
nested teammates"), and supersedes 0020's open question: the teammate workflow survives as the
peer-session preset, settled here. Anchors are `path:line` at `ff45695f1`; re-check before relying
on one.

## The decision

**A teammate is a parallel session placed in the spawning session's pod.** It is not a thread of
the lead session and nothing nests under the lead's log or lease. Concretely:
- **Placement**: the teammate's session shares the lead's sandbox — the same workspace, the same
  `ATLAS_CONTEXT_DIR` content (plans, decisions, coordination notes), the same declared services.
  It is nested under the lead in the sidebar. Shared context files carry **no ownership rule**:
  several agents on one repo is the model, and any two sessions may write the same file, exactly
  as two agents on one checkout do today (decisions.md, 2026-11-02).
- **Ownership**: the **operator** owns the teammate. The operator talks to it directly in its own
  thread, and when it is done the operator archives it; an archived teammate moves to a **Done**
  group under its parent in the sidebar.
- **Conversation**: the operator and the lead's main agent may both message a teammate. The main
  agent is a **peer**, not a manager: it can spawn and message a teammate, and it receives the
  teammate's reports, but it does not archive, stop or own it.

## Three relations v1 conflates

v1 expresses all of this with one column: `Session.managedBySessionId`. `podSessionOf`
(`apps/api/src/api/platform/sessions/session-of-thread.ts:18-37`) walks that chain to find the
session that owns the pod, so the same field decides where a thread runs; it is also what makes a
session a teammate at all (set at spawn, `create-session.ts:70`) and what the sidebar reads to
nest the row (`thread-live-stream.ts:116`). One pointer answers three different questions, and any
change to one relation is indistinguishable from a change to the others — a teammate cannot be
re-parented in the sidebar without implying a pod move, and "managed by" wrongly implies the
manager owns the lifecycle.

v2 separates them into three fields on the session record, each with its own writer:

| Relation         | Question                             | v2 expression                                                                                | Writer                                 |
| ---------------- | ------------------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------- |
| **Placement**    | Which pod, context dir and services? | `podRef` on the session record: the pod the session's worker executes against                | The CP, at spawn and on explicit moves |
| **Ownership**    | Who archives or stops it?            | Nothing to model: every session is operator-owned. Archive is an operator inbox command      | The operator, through the inbox        |
| **Conversation** | Who may message it?                  | The session's sender ACL: the operator plus the sessions that spawned it or are linked to it | CP command handlers (sessions plugin)  |

A "teammate" is then not a kind of row but a preset over ordinary sessions: placement = the
spawner's pod, conversation = operator + spawner, and a `spawned-by` link for the sidebar nesting
and the Done grouping (0020 decision 4).

## Per-session activity

v1's activity reporting is session-scoped in a way that produces two bugs with one cause. The
roster a thread's activity reads is the whole-session roster:
`bindThreadActivity` (`packages/harness/src/activity/binding.ts:31-36`) feeds
`backgroundRunning(roster.snapshot())` (`binding.ts:46-48`) from the session-wide agent and shell
registries, and the cloud mirror does the same through `RuntimeSessionActivity`
(`activity/runtime-session-activity.ts:145-152`). So:
- **The lead counts everyone's work**: a teammate's running sub-agent or shell sets the lead's
  `working` (the session-wide roster fires for every thread).
- **A child thread ignores its own children**: `bindChildThreadActivity`
  (`activity/child-binding.ts:24-44`) subscribes to turn signals only — it never takes a roster,
  so a teammate's own sub-agents and background shells do not mark the teammate as working.

v2 makes activity a **record field per session**: `fold(log) ∧ holder lease liveness` (P6, §6
"Activity / status"), computed from that session's own log. A session's sub-agents live under its
own lease, so `agent-spawned` / shell events in its log are what the fold reads — one session
never reports another's background work, and a session always reports its own.

## Sender as a first-class field

A message into a session comes from the operator, from the main agent, or from a peer, and the
model must be told which (decisions.md). v1 half-has this: `user-said` carries an optional `via`
of `EMessageOrigin` (`packages/core/src/events/body.ts:42-46`, schema at
`core/src/events/schema.ts:63`, defaulted by `saidBy` at `body.ts:75-76`), and spawns and
`agent_say` set it (`agents/registry/open-child.ts:37`, `say.ts:153`). v2's assembly already
renders the lane: `messages-from-events.ts` emits `<operator-said>` for an operator message and
`<agent-said from="…">` for an agent one (`packages/core/src/context/envelope.ts:100-114`).

What was missing is identity, not the lane. A message that crosses sessions carries
`sender: { session }` on the `user-said` body (optional, so old logs decode), the inbox reader
stamps `via: PeerAgent` with it, and assembly renders the session id in `from` — so the model can
tell a peer's words from the operator's and from the main agent's. `sender` refines `via`; the
policy and tldr folds keep reading `via`.

## Multi-session pods

A pod that hosts several sessions is a placement detail, not a session family with a head:
- **Park and wake are pod-level, driven by any session.** The pod's lease is held while any placed
  session is working; parking follows the ordinary rule (flush, release) only when every placed
  session is idle, and a message to any placed session wakes the pod. v1 gets a weak version of
  this by construction — `podSessionOf` collapses the family onto one sandbox — but the wake and
  stuck-sweep paths walk `managedBySessionId` ad hoc (`stuck-sessions.ts:42-48`).
- **Declared services are shared.** `.atlas/services.yaml` is the session's and every placed
  teammate resolves the same declarations against the same pod, because placement puts them on one
  disk with one port space.
- **The lead ending does not end teammates.** Sessions are peers: the lead's lease lapsing or its
  session being archived changes nothing about a teammate's record, inbox or lease. Only the
  shared pod is common, and the reconciler (§13) re-provisions it for whichever placed session has
  unconsumed inbox entries.

## Archive and the Done lifecycle

The operator archives a finished teammate; the row moves to a Done group under its parent in the
sidebar (decisions.md). In v1, archiving is a session field flipped through
`thread-archive.service.ts:32-41` (`Session.archivedAt`, plus subscription teardown and a cleanup
dispatch), and teammates are threaded through the same code as any session — there is no Done
concept and no place for one, because the sidebar has only archived/unarchived.

In v2 archive is an operator-only inbox command, logged as an event (`session-archived`), and the
Done grouping is a **view** (P6): a fold over the session's `spawned-by` link and its archived
state, materialized by the CP. Unarchive is the same command in reverse. Because ownership was
never modelled as `managedBy`, archiving a teammate touches nothing about the lead.

## What v1 already ships vs what v2 makes structural

In flight or merged on v1 (the teammates-as-parallel-sessions slices, plan.md):

| Change           | v1 form                                                                                                                                                                                                          | v2 form                                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Activity scoping | Per-thread roster reads so a child counts its own sub-agents/shells and the lead stops counting teammates' children (slice 1 of the plan; fixes the `binding.ts`/`child-binding.ts` asymmetry above)             | Structural: status is a per-session fold of its own log; there is no shared roster to mis-scope                                                   |
| Sender lanes     | `user-said.via` exists in the schema and is set on spawn/`say`; rendering it to the model is the open slice (assembly still wraps everything as `operatorSaid`)                                                  | Structural: `sender` is an envelope field of the record event and the wire schema; assembly cannot drop it                                        |
| Peer contract    | `TEAMMATE_CONTRACT` says "managed by the main agent" (`agents/types/built-ins.ts:66`, `whenToUse` at `:78-86`, spawn-tool note at `tools/builtin/agent-spawn.ts:38-40`); the rewrite makes the main agent a peer | Structural: no `managedBy` exists; spawn/message are sessions-plugin commands, and the peer relation is the `spawned-by` link plus the sender ACL |
| Archive to Done  | Not present: `setArchived` flips one boolean and the sidebar has no Done group                                                                                                                                   | Structural: archive is an inbox command and Done is a view fold over `spawned-by` + archived state                                                |

## Owned by later slices

- **Slice 4 (views)**: the session view carries `spawned-by`, archived state and the Done grouping;
  the sidebar stops reading `managedBySessionId`.
- **Slice 7 (sessions plugin)**: settled 2026-11-09 — `spawn_session` always places the peer on the
  spawner's pod (the teammate preset has no `into-pod` flag), and `message_session` sets `sender`.
  The only check in `packages/control/src/peer-sessions.ts` is that both sessions belong to the same
  user; there is no message budget (the 20-message cap that shipped was removed the same day at the
  operator's direction).
- **Slice 3 (worker host)**: one worker may hold leases for several sessions placed on one pod;
  park/wake follows "any placed session busy or addressed", and the sandbox daemon is shared.
