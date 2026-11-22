# @dltech/atlas-commands

The command contract: a spec with a name, arguments and timing, plus the registry that indexes
commands by name and by inbox kind. Native commands and plugin commands both use it.

## Owns

- The command spec `CommandSpec`, and `defineCommand` that validates it.
- The name rule: lowercase letters, digits and hyphens, with no slash.
- The registry: `composeCommands` and `commandOf`.
- The inbox kind of a command: `command:<name>`.
- The handler types for the agent host and for the control plane.

## Does not own

- The catalogue of native commands: `commands/`, which is `@dltech/atlas-native-commands`.
- The UI that renders a command: `apps/web`, `apps/tui` and `@dltech/atlas-client`.
- The command event and its argument parsers: `@dltech/atlas-core`.
- Where a command runs: the holder handler runs in the agent host, and the control handler runs in
  the control plane.

## Entry points

| Import                   | Use it for                                         |
| ------------------------ | -------------------------------------------------- |
| `@dltech/atlas-commands` | `defineCommand`, `composeCommands`, handler types. |

## Capabilities

### Define a command

- `defineCommand({spec})`: validates the name, freezes the spec and derives `inboxKind`.
- `CommandSpec`: `name`, `summary`, `group` (`ECommandGroup`), `args` (a `zod` schema), `timing`
  (`ECommandTiming.Immediate` or `.Settled`) and `handledIn` (`'holder'` or `'control'`).
- `Command`: the frozen `{ spec, inboxKind }` value that `defineCommand` returns.

### Find a command

- `composeCommands(commands)`: index the list, and throw on a duplicate name.
- `CommandRegistry`: `all`, `byName`, and `byInboxKind` (holder commands only).
- `commandOf({registry, name})`: one command by name, or `undefined`.
- `COMMAND_INBOX_PREFIX`: the literal `command:`, which prefixes every inbox kind.

### Handle a command

- `CommandHandler<Args>`: runs in the agent host with a `CommandContext<Args>`.
- `CommandContext<Args>`: `args`, `sessionId`, `inboxId`, `model`, `visibleEvents()`, `append()`
  and `log()`.
- `CommandResult`: `{kind: 'done'}` or `{kind: 'refused', reason}`.
- `ControlCommandHandler<Plane, Args>`: runs in the control plane with `{plane, sessionId, args}`.

## Usage

```ts
import { defineCommand } from '@dltech/atlas-commands'
import { ECommandGroup, ECommandTiming } from '@dltech/atlas-core'
import { z } from 'zod'

export const rename = defineCommand({
  spec: {
    name: 'rename',
    summary: 'Rename this session',
    group: ECommandGroup.Session,
    args: z.strictObject({ name: z.string().trim().min(1).max(200) }),
    timing: ECommandTiming.Settled,
    handledIn: 'control',
  },
})
```

## Rules

- A command name is `^[a-z][a-z0-9-]*$`. `defineCommand` throws on any other name.
- Two commands may not share a name. `composeCommands` throws.
- The registry indexes only a `holder` command by inbox kind. A `control` command never reaches the
  agent host.

## See also

- `commands/` for the native commands, and `packages/commands/src/__tests__/registry.spec.ts` for
  the tests of this contract.
- [docs/decisions/0019-v2-package-map.md](../../docs/decisions/0019-v2-package-map.md).
