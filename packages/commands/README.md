# @dltech/atlas-commands

The command contract: one spec per command, the registry that indexes it, the catalogue each
surface lists, the surface table, and the parser that turns a typed line into a command, a skill or a
message. Native commands and plugin commands both use it.

## Owns

- The command spec `CommandSpec`, and `defineCommand` that validates it.
- The name rule: lowercase letters, digits and hyphens, with no slash.
- The registry: `composeCommands` and `commandOf`, with the inbox kind `command:<name>`.
- Where a command runs (`ECommandRunsIn`) and the client action it opens (`EClientAction`).
- The catalogue row `CommandEntry`, `entryOf`, `skillEntryOf` and the one merge in `catalogueOf`.
- The surface table `SURFACE_PROFILES` and `catalogueForSurface`.
- The text layer: `parseInvocation` and `clientActionOf`.
- The handler types for the agent host and for the control plane.

## Does not own

- The catalogue of native commands: `commands/`, which is `@dltech/atlas-native-commands`.
- The skill names and bodies: the skills plugin, which reads them on the pod.
- The UI that renders a command: `apps/web`, `apps/mobile`, `apps/tui`.
- The event log the handlers write: `@dltech/atlas-core`.

## Entry points

| Import                   | Use it for                                                       |
| ------------------------ | ---------------------------------------------------------------- |
| `@dltech/atlas-commands` | The spec, the registry, the catalogue, the parser, the handlers. |

## Capabilities

### Define a command

- `defineCommand({spec})`: validates the name and the client action, freezes the spec and derives
  `inboxKind`.
- `CommandSpec`: `name`, `summary`, `group` (`ECommandGroup`), `argumentHint`, `args` (a `zod`
  schema), `runsIn` (`ECommandRunsIn`), `fromText` and `opens` (`EClientAction`).
- `TextArgs`: what `fromText` answers — the parsed `args`, or the refusal `reason`.
- `Command`: the frozen `{ spec, inboxKind }` value that `defineCommand` returns.

### Find a command

- `composeCommands(commands)`: index the list, and throw on a duplicate name.
- `CommandRegistry`: `all`, `byName`, and `byInboxKind` (host commands only).
- `commandOf({registry, name})`: one command by name, or `undefined`.
- `COMMAND_INBOX_PREFIX`: the literal `command:`, which prefixes every inbox kind.

### Build a catalogue

- `entryOf({command, source})`: one row for a command, `source` being `builtin` or `plugin`.
- `skillEntryOf({name, description, argumentHint})`: one row for a skill, in the workspace group.
- `catalogueOf({commands, skills})`: drop a skill whose name matches a command, then sort by group
  (context, session, workspace) and by name.
- `catalogueForSurface({entries, surface})`: drop the names the surface hides.
- `SURFACE_PROFILES`: each surface's hidden names, with the reason, and the name it picks.

### Read a typed line

- `parseInvocation({text, commands, skills})`: an `Invocation` whose `kind` is `EInvocation.Message`, `.Command`, `.Skill` or `.Refused`.
- `clientActionOf({text, commands})`: the `EClientAction` a typed client command opens, or `null`.
- `clientActionOfEntries({text, entries})`: the same question against a surface's catalogue rows, for
  a client that holds `CommandEntry[]` and no registry. A name followed by argument text returns
  `null`, so the host refuses that line rather than the client swallowing it.

### Handle a command

- `CommandHandler<Args>`: runs in the agent host with a `CommandContext<Args>`.
- `CommandResult`: `{kind: 'done'}` or `{kind: 'refused', reason}`.
- `ControlCommandHandler<Plane, Args>`: runs in the control plane with `{plane, sessionId, args}`.

## Usage

```ts
import {
  catalogueForSurface,
  catalogueOf,
  composeCommands,
  EClientAction,
  ECommandGroup,
  ECommandRunsIn,
  ESurface,
  defineCommand,
  entryOf,
  ECommandSource,
  parseInvocation,
  skillEntryOf,
} from '@dltech/atlas-commands'
import { z } from 'zod'

export const rename = defineCommand({
  spec: {
    name: 'rename',
    summary: 'Rename this session',
    group: ECommandGroup.Session,
    argumentHint: '<name>',
    args: z.strictObject({ name: z.string().min(1) }),
    runsIn: ECommandRunsIn.Control,
    fromText: (text) =>
      text === ''
        ? { ok: false, reason: '/rename needs a name' }
        : { ok: true, args: { name: text } },
  },
})

const commands = composeCommands([rename])
const invocation = parseInvocation({ text: '/rename bench', commands, skills: [] })
const menu = catalogueForSurface({
  entries: catalogueOf({
    commands: commands.all.map((command) => entryOf({ command, source: ECommandSource.Builtin })),
    skills: [skillEntryOf({ name: 'review', description: 'Review a change', argumentHint: null })],
  }),
  surface: ESurface.Web,
})
```

## Rules

- A command name is `^[a-z][a-z0-9-]*$`. `defineCommand` throws on any other name.
- A `client` command must name the `EClientAction` it opens. A `host` or `control` command may not.
- Two commands may not share a name. `composeCommands` throws.
- The registry indexes only a `host` command by inbox kind.
- Text parses against the full registry, never against a surface's menu. Hiding is menu-only.
- A command beats a skill of the same name, and `catalogueOf` drops that skill.

## See also

- `commands/` for the native commands, and `packages/commands/src/__tests__/` for the specs.
- [docs/decisions/0019-v2-package-map.md](../../docs/decisions/0019-v2-package-map.md).
