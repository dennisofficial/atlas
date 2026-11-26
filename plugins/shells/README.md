# @dltech/atlas-plugin-shells

Background shells for a pod: start a command that outlives the turn, read what it prints, answer
its prompt, stop it and list it. The API composes it as the `shells` plugin, and a surface reads
its roster view.

## Owns

- The shell tools: `shell_output`, `shell_input`, `shell_kill` and `shell_list`. `bash` with
  `background: true` starts the shell, and this plugin records it.
- The record of each shell: its name, its status, its printed size and its read cursor. A shell is
  named by the description the agent gave, or by its command when the call gave none.
- The `shells` view, which folds the `background-shell-*` events into one row for each shell.
- The `shells.background` prompt fragment.

## Does not own

- A command that the model waits on. The harness tool set gives the model `bash` for it.
- The terminal pane and the way a surface draws it. The surface reads the `shells` view.

## Entry points

| Import                                | Use it for                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `@dltech/atlas-plugin-shells/core`    | `shellsCoreSlots`, the `shells` view fold, its schemas and `ShellRow`.                            |
| `@dltech/atlas-plugin-shells/pod`     | `shellsPod`: four tools, the hooks and the prompt fragment.                                       |
| `@dltech/atlas-plugin-shells/control` | `shellsControl`, an empty control slot.                                                           |
| `@dltech/atlas-plugin-shells/client`  | `shellsClient`, `shellsOfView`, `shellRosterOf` and the `ShellRoster` and `ShellRosterRow` types. |

## Capabilities

### Read the roster

- `shellsView`: the view fold with the name `shells`.
- `foldShells(state, event)`: add or update one row. The status is `running`, `exited`, `killed` or `overflowed`.
- `shellsOfEvents(events)` and `shellsOfView(views)`: the rows of a log or of a view record.
- `shellRosterOf(views)`: the running shells, their count and whether one waits for input.
- `looksLikePrompt(text)` (pod tier): true when the printed text ends in a prompt.

## Plugin contributions

### The tools the model sees

| Tool           | What it does                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `shell_output` | Read what the shell printed since the last read. Each call consumes what it returns.                                          |
| `shell_input`  | Write `text` to the stdin of a shell that `bash` started with `input: true`. Set `end` to close the stdin for good.           |
| `shell_kill`   | Signal the whole process group. Return the next unread chunk, at most 32,768 bytes, with the count of characters that remain. |
| `shell_list`   | List the shells this session started, with id, command, state and printed size. `runningOnly` leaves out ended shells.        |

### The slots

`shellsPod` gives the four tools, the after-tool hook, the daemon listener, the reconcile and the
`shells.background` prompt fragment.
- `shells-adopted-bash` (afterTool): drafts `background-shell-started` when a `bash` call returns
  a backgrounded shell, and records that the shell has a stdin.
- The daemon listener: records a shell ending, and publishes the shell output as it arrives.
- The reconcile runs when a host takes the session over and when the daemon restarts under the same
  host. It adopts each open shell the daemon still lists and records one ending for a shell it does
  not, so a pod that only slept and woke posts no ending.

`shell_output` marks a shell that waits for input and sends the `background-shell-awaiting-input`
notice.

`shellsCoreSlots` gives the `shells` view and one command:

| Command       | Argument | What it does                                                          |
| ------------- | -------- | --------------------------------------------------------------------- |
| `/shell-kill` | `<id>`   | Stop a running shell. Runs in the host, never in a session catalogue. |

`shellKillHandlerOf(ctx)` in `src/pod/commands.ts` calls the same `killShell` the `shell_kill` tool
calls, forgets the shell's awaiting-input mark, and returns `done` after appending one
`command-applied` row naming its inbox id. A replay of a kill that already happened is refused by
the daemon, which settles the command. A refused kill carries the daemon's own sentence. The handler does not read the delta the tool reads: the loop needs the
output, the operator reads the tail from the followed snapshot. `shellsClient` gives one
hook, `shells-roster`, which applies to the `background-shell-*` events.

## Usage

```ts
import { definePlugin } from '@dltech/atlas-plugin-sdk'
import { shellsClient } from '@dltech/atlas-plugin-shells/client'
import { shellsControl } from '@dltech/atlas-plugin-shells/control'
import { shellsCoreSlots } from '@dltech/atlas-plugin-shells/core'
import { shellsPod } from '@dltech/atlas-plugin-shells/pod'

definePlugin({
  name: 'shells',
  ...shellsCoreSlots,
  pod: shellsPod,
  control: shellsControl,
  client: shellsClient,
  transport: 'stream',
})
```

## Rules

- Import the pod tier in a pod only. It calls the host of the session.
- Import the core tier in a client. It is pure and reads no filesystem.
- Do not call `shell_output` to learn whether a shell ended. The ending arrives as its own event.
- The stdin of a shell is a pipe, not a terminal. A full-screen program does not work there.

## See also

- `docs/architecture.md`
- `docs/decisions/0019-v2-package-map.md`
- `packages/plugin-sdk/src/slots.ts` for the `PodSlot` contract.
