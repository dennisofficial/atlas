# @dltech/atlas-native-commands

The native session commands: `rewind`, `summarise`, `rename`, `resize`, `cancel-resize`, `rotate`,
`model` and `help`. The API adds them to the command registry of every session.

## Owns

- The eight command specs, their zod arguments, their argument hints and the text form of `rewind`,
  `summarise`, `rename` and `resize`.
- The holder handlers for `rewind` and `summarise`, which run in the agent host.
- The control handler for `rename`, which sets the session title.
- The disk limit of a resize.

## Does not own

- The command contract, the registry, the catalogue and the parser. `@dltech/atlas-commands` owns
  them.
- The handler that applies a resize. The control plane supplies it for each session.
- The commands of a feature, such as `/shells`. They live in that plugin.

## Entry points

| Import                          | Use it for                                                           |
| ------------------------------- | -------------------------------------------------------------------- |
| `@dltech/atlas-native-commands` | The specs, the two handler maps, the resize pieces and the refusals. |

## Capabilities

### The command list

- `nativeCommands`: the specs, in declaration order — `rewind`, `rename`, `summarise`, `rotate`,
  `resize`, `cancel-resize`, `model`, `help`.
- `nativeCommandHandlers`: one holder handler for each `host` command, keyed by `inboxKind`.
- `nativeControlHandlers`: the `rename` handler, keyed by the command name.
- `rename`, `resize`, `resizeArgs`, `RESIZE_MAX_DISK_GB`: the rename and resize specs, and the
  resize disk limit of 100 GB. The API supplies the resize handler, so `nativeControlHandlers` has
  none for it.
- `cancelResize`, `cancelResizeArgs`: the cancel spec, which takes an empty argument object and
  cancels a resize that waits for the pod to go idle. The API supplies the handler.
- `model`, `help`: the two client commands. Each opens one `EClientAction`, and neither runs
  anywhere on the server.

### Read a rewind target

- `rewindTargetOf({ events, toSeq })`: the draft to edit again, or the reason to refuse. Only a
  `user-said` event can be a target, and not the last event.
- `REFUSAL_NOT_A_MESSAGE`, `REFUSAL_NOTHING_TO_REWIND`: the refusal texts.
- `rewind.spec.fromText`: `/rewind <seq>` reads the message sequence. An absent or non-numeric
  argument refuses with `REFUSAL_REWIND_NEEDS_LINE`, the sentence that points at the picker.
- `summarise.spec.fromText`: `/summarise` with no argument targets everything before the last
  message; `/summarise <seq>` targets a named boundary. Any other argument refuses with
  `REFUSAL_SUMMARISE_ARGS`. `summariseArgs` leaves `throughSeq` optional for the default.

### Refusals

- `REFUSAL_RENAME_NEEDS_NAME`: what `/rename` answers with no name.
- `REFUSAL_RESIZE_USAGE`: what `/resize` answers with arguments it cannot read.
- `REFUSAL_NO_MODEL`, `REFUSAL_EMPTY_SUMMARY`, `REFUSAL_SUMMARY_FAILED`: the summarise sentences.
- `REFUSAL_SUMMARISE_ARGS`: what `/summarise` answers with an argument that names no message.

## Usage

```ts
import { composeCommands, ECommandSource, entryOf } from '@dltech/atlas-commands'
import { nativeCommandHandlers, nativeCommands } from '@dltech/atlas-native-commands'

const commands = composeCommands([...nativeCommands, ...pluginCommands])
const handlers = new Map([...nativeCommandHandlers, ...pluginPodCommands])
const builtinEntries = nativeCommands.map((command) =>
  entryOf({ command, source: ECommandSource.Builtin }),
)
```

## Rules

- Register a holder handler under `command.inboxKind`. Register a control handler under
  `command.spec.name`. The two maps never mix.
- `resize` and `cancel-resize` are in `nativeCommands` but have no handler here. The control plane
  supplies one per session.
- `rewind` and `summarise` change the event log of the session. They run in the host, and they
  refuse a sequence number that names no message.

## See also

- `docs/v2/architecture.md`
- `docs/decisions/0019-v2-package-map.md`
- `packages/commands/README.md` for the `CommandSpec` contract.
