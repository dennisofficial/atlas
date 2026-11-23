# @dltech/atlas-plugin-sessions

The tools a pod uses to reach other sessions, and the plan view. The API composes it as the
`sessions` plugin; a surface reads the plan and the peer tree from the client tier.

## Owns

- Six tools: `send_message`, `archive_session`, `spawn_session`, `spawn_teammate`,
  `list_sessions` and `list_teammates`.
- The `plan` view, which folds the plan tasks the model keeps for its turn.
- `nestPeers`, which builds the tree of teammates under each spawner.
- The `sessions.peers` prompt fragment, which adds the spawner line to a session that another
  session started.

## Does not own

- The session store and the sandbox of a spawned session. The `PodSessions` port owns them.
- Stopping a session. The operator does that.
- The title of a session. The `rename` command sets it (`@dltech/atlas-native-commands`).

## Entry points

| Import                                  | Use it for                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `@dltech/atlas-plugin-sessions/core`    | `sessionsCoreSlots` with the `plan` view, `PLAN_VIEW` and `planViewSchema`. |
| `@dltech/atlas-plugin-sessions/pod`     | `sessionsPod`: the six tools and the `sessions.peers` prompt fragment.      |
| `@dltech/atlas-plugin-sessions/control` | `sessionsControl`, an empty control slot.                                   |
| `@dltech/atlas-plugin-sessions/client`  | `nestPeers` and `planOfView`.                                               |

## Capabilities

### Read the plan

- `PLAN_VIEW`: the view name, `plan`.
- `planViewSchema`: the schema of the plan view. The fold itself stays in `@dltech/atlas-core`.
- `planOfView(views)`: the `PlanTask[]` of the plan view, or an empty list.

### Build the peer tree

- `nestPeers(rows)`: rows to a tree by `spawnedBy`. A row with `nested: false`, a row with no
  spawner and a row whose spawner is archived all become a root.

## Plugin contributions

### The tools the model sees

| Tool              | What it does                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `send_message`    | Send `{to, text}` to any agent or session of the operator's, or to `parent` for whoever started you.       |
| `archive_session` | Archive a session this session spawned, once its work is done. Same archive as the operator's button.      |
| `spawn_session`   | Create an independent session at the top level, like the new-session button. `brief` is its first message. |
| `spawn_teammate`  | Create a teammate nested under this session. It reaches you with `send_message` to `parent`.               |
| `list_sessions`   | List the sessions of the operator, with the current one marked.                                            |
| `list_teammates`  | List the nested teammates of this session, newest first.                                                   |

Every line of a list names whether the session is working, idle, failed or archived.

Both spawn tools take an optional `title`, the name of the new session. They take an optional
`brief`, its first message. A session with no brief waits for a message.

Both spawn tools take `files`: paths relative to `$ATLAS_CONTEXT_DIR`. The files are read before
the spawn, carried on the spawn message, and written into the spawned session's own context folder
before its first turn. An unsafe, missing or oversized file refuses the whole spawn, so no session
is created.

### The slots

`sessionsPod` gives the six tools and the `sessions.peers` prompt fragment.

`sessionsCoreSlots` gives the `plan` view and no events or commands. The client tier gives
functions, not a slot object; the API passes `client: { hooks: [] }`.

## Usage

```ts
import { definePlugin } from '@dltech/atlas-plugin-sdk'
import { sessionsControl } from '@dltech/atlas-plugin-sessions/control'
import { sessionsCoreSlots } from '@dltech/atlas-plugin-sessions/core'
import { sessionsPod } from '@dltech/atlas-plugin-sessions/pod'

definePlugin({
  name: 'sessions',
  ...sessionsCoreSlots,
  pod: sessionsPod,
  control: sessionsControl,
  client: { hooks: [] },
  transport: 'none',
})
```

## Rules

- A pod with no sessions port refuses `spawn_session` and `spawn_teammate`. `send_message`
  returns a refusal when it reaches no agent or session.
- A spawn carries at most 32 files, 256 KB each and 1 MB in all. `files` names files under the
  caller's `$ATLAS_CONTEXT_DIR`, by relative name; a symlink is followed and its content is sent.
- Use `spawn_teammate` for a workstream this session owns. Use `spawn_session` only for work that
  belongs to the operator.
- `send_message` is never deferred. It refuses an id that names no agent or session of the
  operator's, and the refusal names the tools that list ids.
- `archive_session` archives only a session this one spawned: a teammate or a `spawn_session`
  session. Any other session is refused, and so is one that is still working.
- Pass `{ hooks: [] }` as the client slot. This package exports no client slot object.

## See also

- `docs/v2/architecture.md`
- `docs/decisions/0020-v2-sub-agent-worktrees-and-peer-sessions.md`
- `packages/plugin-sdk/src/slots.ts` for the `PodSlot` contract.
