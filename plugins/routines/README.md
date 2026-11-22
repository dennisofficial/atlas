# @dltech/atlas-plugin-routines

The `routine` tool. A routine is a saved prompt that runs on a cron, in a new session each time.
The tool lists, reads, creates, changes, deletes and runs the routines of this session's project.
The API composes it as the `routines` plugin.

## Owns

- The `routine` tool and its input schema, with six actions.
- The rules between its fields: what each action needs, and when an update changes nothing.
- The description the model reads for each action.

## Does not own

- The routine store, the cron parser and the scheduler. The `PodRoutines` port reaches them, and
  the control plane implements them.
- The session that a run starts. `run` asks for it and returns its id.

## Entry points

| Import                                  | Use it for                                         |
| --------------------------------------- | -------------------------------------------------- |
| `@dltech/atlas-plugin-routines/core`    | `routinesCoreSlots`: no events, views or commands. |
| `@dltech/atlas-plugin-routines/pod`     | `routinesPod`: the `routine` tool.                 |
| `@dltech/atlas-plugin-routines/control` | `routinesControl`, an empty control slot.          |
| `@dltech/atlas-plugin-routines/client`  | `routinesClient`, a client slot with no hooks.     |

## Capabilities

- `ROUTINE_TOOLS`: `['routine']`.
- `routinesPod`: the tool, with the `PodRoutines` port of the pod context.
- The other tiers add nothing: `routinesCoreSlots` has empty events, views and commands,
  `routinesControl` is `EMPTY_CONTROL`, and `routinesClient` is `{ hooks: [] }`.

## Plugin contributions

### The tool the model sees

`routine` takes one `action`:

| Action   | Needs                                     | What it does                                                                                                                      |
| -------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `list`   | nothing                                   | Name each routine with its id, cron, state and next run.                                                                          |
| `get`    | `routineId`                               | Read one routine and its full prompt.                                                                                             |
| `create` | `name`, `prompt`, `cron`, `timezone`      | Save a routine in this project.                                                                                                   |
| `update` | `routineId`, and at least one other field | Change the fields passed. `enabled: false` pauses the routine. A `null` `model`, `effort` or `fast` restores the project default. |
| `delete` | `routineId`                               | Remove a routine for good. Its past sessions stay.                                                                                |
| `run`    | `routineId`                               | Start the routine now, off its schedule, in its own session.                                                                      |

The tool sets `deferred`, so the model loads it with `tool_search` and calls it with `call_tool`.

## Usage

```ts
import { definePlugin } from '@dltech/atlas-plugin-sdk'
import { routinesClient } from '@dltech/atlas-plugin-routines/client'
import { routinesControl } from '@dltech/atlas-plugin-routines/control'
import { routinesCoreSlots } from '@dltech/atlas-plugin-routines/core'
import { routinesPod } from '@dltech/atlas-plugin-routines/pod'

definePlugin({
  name: 'routines',
  ...routinesCoreSlots,
  pod: routinesPod,
  control: routinesControl,
  client: routinesClient,
  transport: 'none',
})
```

## Rules

- The tool reaches one project only: the project of this session. No other project is reachable.
- Give `create` a value for `model`, `effort` and `fast`, or omit the field to follow the project
  default. `create` refuses `null` for these three. `enabled` defaults to `true`.
- On `update`, a `null` `model`, `effort` or `fast` restores the project default.
- Read `cron` as five fields in the IANA zone of `timezone`. The control plane refuses a cron that it cannot parse. It refuses an unknown timezone. It refuses a cron that runs more often than every five minutes.
- A pod whose routines port is empty fails every action with the port's reason.

## See also

- `docs/v2/architecture.md`
- `docs/decisions/0019-v2-package-map.md`
- `packages/plugin-sdk/src/routines.ts` for the `PodRoutines` port.
