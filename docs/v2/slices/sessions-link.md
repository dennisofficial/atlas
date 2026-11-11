# Spec: sessions own their pods

Status: **spec, 2026-11-11**, for operator approval. Anchors are at `e237d950`; re-check before
relying on one. Predecessor work: [#2223](https://github.com/dennisofficial/atlas/pull/2223), which
put a sub-agent's report in the agent lane and stopped a peer message rendering as the operator's.

## Goal

A session created by another session is an ordinary session: its own sandbox, clone, conversation and
lifecycle, linked to the one that created it by provenance and a message channel. A teammate is that
session — not a second kind of session sharing someone else's sandbox. A main session orchestrates
teammates; each teammate does its own work, opens its own PRs, and can fan out sub-agents inside its
own pod.

**Exit criteria**
1. `spawn_session` has no `intoPod`, and every spawned session gets its own pod; the control plane
   cannot place a session on another session's pod.
2. A spawned session's context names the session that created it, and it can report back
   (`report_to_spawner`), which wakes the creator in the agent lane, once — the path #2223 fixed for
   crew.
3. `list_sessions` carries status, so a creating session can see which teammate is working, idle or
   failed without asking.
4. The sidebar keeps provenance grouping and stops calling a spawned session a teammate; a row shows
   what it came from, not that it shares a sandbox.
5. A sub-agent may commit on its worktree branch, push it and open a PR, and its spawner sees the
   URL.
6. v1 is unchanged; every app composes.

## 1. What exists today

- **`intoPod` is a second kind of session.** `spawnPeerIn` reads it (`packages/control/src/peer-sessions.ts:20`),
  refuses a teammate spawning a teammate (`:21`) and sets `podSessionId` to the spawner's pod
  (`:32`). It rides the port (`packages/plugin-sdk/src/sessions.ts:17`), the host
  (`packages/host/src/holder/plugin-sessions.ts:7-18`) and the tool's schema and prose
  (`plugins/sessions/src/pod/spawn-tool.ts:16,22,27-28`) into the prompt
  (`plugins/sessions/src/pod/fragment.ts:10`).
- **A spawned session does not know its creator.** No prompt fragment or tool carries
  `spawnedBySessionId`; `list_sessions` shows it (`packages/host/src/holder/plugin-sessions.ts:33`)
  but the child cannot act on it.
- **`SessionBrief` has no status** (`packages/plugin-sdk/src/sessions.ts:1-7`), though the session
  summary already carries one (`packages/control/src/session-summary.ts:26-32`).
- **The sidebar groups by provenance and calls the group teammates.**
  `nestPeers` (`plugins/sessions/src/client/index.ts`) nests by `spawnedBy` for every spawned session;
  `apps/web/src/features/shell/v2-rows.ts:43-65` builds the nodes and
  `apps/web/src/features/shell/shell-teammate-folder.tsx` renders them.
- **A sub-agent already can push.** The sandbox shell carries `GH_TOKEN`, git identity and signing
  (`apps/agent-host/src/runtime/shell-env.ts:66-80`), and `agent_spawn {worktree}` puts a child on its
  own branch (`plugins/crew/src/pod/spawn-tool.ts:18-28`). What is missing is that anyone says so.

## 2. Remove `intoPod`

Delete it end to end: the field on `PodSessions.spawn` and `spawnPeerIn`, the tool's schema,
description and `modelTextOf`, and the fragment sentence. `spawnPeerIn` keeps
`spawnedBySessionId` and stops writing `podSessionId`. The refusal at `:21` goes with it: a spawned
session that creates another gets an ordinary session, which is what the operator asked for.

Tests: `packages/control` conformance (`spawn` no longer sets `podSessionId`, two spawned sessions
never share one), the plugin's spawn spec, and the fragment text.

## 3. The way back

A teammate is a session; the report channel is therefore a session-shaped message, not a crew one.
- **The child learns its creator.** A prompt fragment from `plugins/sessions` names the spawner's id
  and title, read from the session row the holder already has.
- **`report_to_spawner {kind, text}`** posts to the creator's inbox with
  `senderSessionId = the reporting session`, so intake stamps `via: peer-agent` and the sender
  (`packages/host/src/holder/inbox-intake.ts`). The body is the message; there is no separate
  durable event, unlike crew — a session's report _is_ its message.
- **Wake rule** mirrors crew (`reportWakesParent`): done, blocked and needs-decision wake; progress
  does not. The tool is a session's `report_to_main`, so the pod port grows one method
  (`PodSessions.report`) and the control plane one operation (`reportToSpawner`), which resolves the
  spawner from the session row rather than trusting an id from the model.
- **Not a new lane.** #2223 made a `user-said` with a sender render and assemble as an agent message;
  this slice only has to produce one.

## 4. Status in `list_sessions`

Add `status: {state, reason?, since?} | null` to `SessionBrief`, filled from the summary the control
plane already materialises, and render it on the tool's line ("working", "idle", "failed: reason",
"archived"). Read-only; no new query.

## 5. The sidebar tells the truth

Keep the nesting — the operator wants provenance visible — and change what it says:
- The group is a session's _created sessions_, not its teammates: the folder's label and any
  affordance copy say so; no shared-pod wording anywhere.
- The row keeps its own branch and PR (it has its own pod now), which is already how
  `v2View` is built.

## 6. Sub-agents open their own PRs

No plumbing: the token and identity are in the shell environment, and the worktree is the child's own
branch. The change is that the contract says so:
- `plugins/crew`'s fragment and the built-in agent contracts state that a child may commit on its
  worktree branch, push it and open a PR with `gh`, and that it must report the URL.
- A spec proves the child's `gh` runs with `GH_TOKEN` from the shell env (the process port double for
  the argv and env) and that a child in a worktree sees its branch as `current`.
- Live check: one child in its own worktree commits, pushes and opens a PR; the parent's report names
  the URL, and the session view shows the branch and PR.

## 7. Out of scope

- Nested teammates (a teammate creating a teammate) beyond "it just works as a session".
- Production gaps carried from the smoke test: the lease fence, the browser lifecycle, the
  `web_search` fallback, the session-dir env. They are their own slice.
- TUI and mobile surfaces for any of this (slice 9).
- Per-teammate budgets or limits.

## 8. Open question for the operator

1. **Where a report lands.** Today `report_to_spawner` would post a normal message into the creator's
   transcript. Confirm that is wanted, or that it should also mark the session view (a
   `spawned-report` counter) so a creating session sees outstanding reports without reading the
   transcript.
