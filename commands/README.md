# @dltech/atlas-native-commands

The native session commands: `rewind`, `rename` and `summarise`, plus the `resize` spec. The API
adds them to the command registry of every session.

## Owns

- The command specs `rewind`, `rename` and `summarise`, and their zod arguments.
- The holder handlers for `rewind` and `summarise`, which run in the pod.
- The control handler for `rename`, which sets the session title.
- The `resize` spec, its arguments and its disk limit.

## Does not own

- The command contract, the registry and the argument parsing. `@dltech/atlas-commands` owns them.
- The handler that applies a resize. The control plane supplies it for each session.
- The commands of a feature, such as `/shells`. They live in that plugin.

## Entry points

| Import                          | Use it for                                                           |
| ------------------------------- | -------------------------------------------------------------------- |
| `@dltech/atlas-native-commands` | The specs, the two handler maps, the `resize` spec and the refusals. |

## Capabilities

### The command list

- `nativeCommands`: the specs of `rewind`, `rename` and `summarise`. The holder handles `rewind` and `summarise`. The control plane handles `rename`.
- `nativeCommandHandlers`: one holder handler for each holder command, keyed by `inboxKind`.
- `nativeControlHandlers`: the `rename` handler, keyed by the command name.
- `resize`, `resizeArgs`, `RESIZE_MAX_DISK_GB`: the resize spec and its limit of 100 GB. The
  control plane adds this spec to its own registry and supplies its handler.

### Read a rewind target

- `rewindTargetOf({ events, toSeq })`: the draft to edit again, or the reason to refuse. Only a
  `user-said` event can be a target, and not the last event.
- `REFUSAL_NOT_A_MESSAGE`, `REFUSAL_NOTHING_TO_REWIND`: the refusal texts.

### Summarise refusals

- `REFUSAL_NO_MODEL`, `REFUSAL_EMPTY_SUMMARY`, `REFUSAL_SUMMARY_FAILED`.

## Usage

```ts
import { composeCommands } from '@dltech/atlas-commands'
import { nativeCommandHandlers, nativeCommands } from '@dltech/atlas-native-commands'

const commands = composeCommands([...nativeCommands, ...pluginCommands])
const commandHandlers = new Map([...nativeCommandHandlers, ...pluginPodCommands])
```

## Rules

- Register a holder handler under `command.inboxKind`. Register a control handler under
  `command.spec.name`. The two maps never mix.
- The `resize` spec is not in `nativeCommands`. Add it to the control registry yourself, with its
  handler.
- `rewind` and `summarise` change the event log of the session. They run in the holder, and they
  refuse a sequence number that names no message.

## See also

- `docs/v2/architecture.md`
- `docs/decisions/0019-v2-package-map.md`
- `packages/commands/src/spec.ts` for the `CommandSpec` contract.
