# @dltech/atlas-native-commands

The native session commands: `rewind`, `summarise`, `rename`, `resize`, `cancel-resize`, `rotate`,
`resume`, `model`, `help`, `skills`, `mcp` and `shells`. The API adds them to the command registry of
every session.

## Owns

- The twelve command specs, their zod arguments, their argument hints and the text form of `rewind`,
  `summarise`, `rename`, `resize`, `rotate` and `resume`.
- The holder handlers for `rewind`, `summarise`, `rotate` and `resume`, which run in the agent host.
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
  `resume`, `resize`, `cancel-resize`, `model`, `help`, `skills`, `mcp`, `shells`.
- `nativeCommandHandlers`: one holder handler for each `host` command, keyed by `inboxKind`.
- `nativeControlHandlers`: the `rename` handler, keyed by the command name.
- `rename`, `resize`, `resizeArgs`, `RESIZE_MAX_DISK_GB`: the rename and resize specs, and the
  resize disk limit of 100 GB. The API supplies the resize handler, so `nativeControlHandlers` has
  none for it.
- `cancelResize`, `cancelResizeArgs`: the cancel spec, which takes an empty argument object and
  cancels a resize that waits for the pod to go idle. The API supplies the handler.
- `model`, `help`, `skills`, `mcp`, `shells`: the client commands. Each opens one
  `EClientAction` (`ModelPicker`, `CommandList`, `Skills`, `Mcp`, `Shells`) and none runs anywhere
  on the server. A surface without the panel hides the name; the TUI draws all three.

### Read a rewind target

- `rewindTargetOf({ events, toSeq })`: the draft to edit again, or the reason to refuse. Only a
  `user-said` event can be a target, and not the last event.
- `REFUSAL_NOT_A_MESSAGE`, `REFUSAL_NOTHING_TO_REWIND`: the refusal texts.
- `rewind.spec.fromText`: `/rewind <seq>` reads the message sequence. An absent or non-numeric
  argument refuses with `REFUSAL_REWIND_NEEDS_LINE`, the sentence that points at the picker.
- `summarise.spec.fromText`: `/summarise` with no argument targets everything before the last
  message; `/summarise <seq>` targets a named boundary. Any other argument refuses with
  `REFUSAL_SUMMARISE_ARGS`. `summariseArgs` leaves `throughSeq` optional for the default.

### Rotate the context

- `rotate`: the spec. It takes optional `instructions`, and its text form trims them.
- `rotateNow({model, visibleEvents, append, instructions, auto, log})`: ask the model for a handoff
  brief, then append one `rotated` event. The automatic rotation after a turn calls it too.
- `REFUSAL_ROTATE_CHILDREN`: the refusal while a sub-agent runs.
- `REFUSAL_ROTATE_NOTHING`, `REFUSAL_ROTATE_NO_MODEL`, `REFUSAL_ROTATE_UNCHANGED`,
  `REFUSAL_ROTATE_EMPTY`, `REFUSAL_ROTATE_FAILED`: the refusal sentences of the handler.
- `ROTATE_TIMEOUT_MS`: the 120-second limit on the model call.

### Resume a stopped turn

- `resume`: the spec. It takes an optional `agentId`, and its text form accepts only `--agent <id>`;
  any other argument refuses with `REFUSAL_RESUME_TEXT`.
- `resumeNow({point, inboxId, append})`: append one `resume-marked` event for a resumable point, or
  refuse with the point's own sentence.
- `resumeMarkedDraft({point, inboxId})`: the marker draft of a clean or tool-interrupted point.
- `REFUSAL_RESUME_AGENT`: what `/resume --agent` answers for an id this session does not have.

### Refusals

- `REFUSAL_RENAME_NEEDS_NAME`: what `/rename` answers with no name.
- `REFUSAL_RESIZE_USAGE`: what `/resize` answers with arguments it cannot read.
- `REFUSAL_NO_MODEL`, `REFUSAL_EMPTY_SUMMARY`, `REFUSAL_SUMMARY_FAILED`: the summarise sentences.
- `REFUSAL_SUMMARISE_ARGS`: what `/summarise` answers with an argument that names no message.
- `REFUSAL_RESUME_TEXT`: what `/resume` answers with words after it.

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
- `rewind`, `summarise`, `rotate` and `resume` change the event log of the session. They run in the
  host. `rewind` and `summarise` refuse a sequence number that names no message.

## See also

- `docs/v2/architecture.md`
- `docs/decisions/0019-v2-package-map.md`
- `packages/commands/README.md` for the `CommandSpec` contract.
