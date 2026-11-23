# @dltech/atlas-plugin-operator

Asks the operator for a value that only they have. The `operator_input` tool writes the answer to a file, and the `operator_shell_input` tool types the answer into the stdin of a background shell. The call parks until the operator answers or cancels.

## Owns

- The two tools `operator_input` and `operator_shell_input`.
- The request schema: the `input` kind and the `shell` kind.
- The events `operator-input-asked` and `operator-input-settled`.
- The transcript fold that pairs the ask with its outcome and draws the card.
- The answer payload that the client posts back: a sealed value, or a cancel.
- The prompt fragment that tells the model to ask instead of guess.

## Does not own

- The delivery of the answer to the parked call. `apps/api` owns the request registry and the inbox row.
- The card that the operator taps. Each client draws it from the transcript entry.
- The encryption of the value. The API supplies `seal` and reads the value from the file.

## Entry points

| Import                                  | Use it for                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| `@dltech/atlas-plugin-operator/core`    | The tool names, the request and outcome schemas, the two event schemas and the result texts. |
| `@dltech/atlas-plugin-operator/pod`     | `operatorPod`: the two tools and the prompt fragment.                                        |
| `@dltech/atlas-plugin-operator/control` | `operatorControl`: an empty control slot.                                                    |
| `@dltech/atlas-plugin-operator/client`  | `operatorClient` and `operatorRequestEntries`: the client slot and the request fold.         |

## Capabilities

### Ask the operator

- `OPERATOR_INPUT_TOOL` and `OPERATOR_SHELL_INPUT_TOOL` name the two tools. `OPERATOR_TOOL_NAMES` holds both.
- `OperatorInputTool` and `OperatorShellInputTool`: the tool classes themselves.
- `operatorRequestSchema`: the request that the pod records. The `input` kind holds a prompt; the `shell` kind adds a `shellId`.

### Read the outcome

- `EOperatorRequestOutcome`: `delivered`, `cancelled`, `abandoned`, `expired` or `failed`.
- `deliveredTextOf(args)`, `refusalTextOf(reason)` and `parkedTextOf()`: the model text for a delivered value, for a refusal and for a parked call.
- `operatorAnswerPayloadSchema`: the payload that comes back, either `{ callId, sealedValue }` or `{ callId, cancel: true }`.

## Plugin contributions

### Pod tier (`operatorPod`)

| Kind       | Name                   | What it adds                                                                          |
| ---------- | ---------------------- | ------------------------------------------------------------------------------------- |
| Tool       | `operator_input`       | Asks for a value and writes the answer to a file under `$ATLAS_SESSION_DIR/requests`. |
| Tool       | `operator_shell_input` | Asks for a value and types it into the stdin of the named shell.                      |
| Prompt     | `operator.input`       | Tells the model to ask for a secret and not to guess, and never to echo it.           |
| Child deny | both tools             | A sub-agent cannot ask. It asks the parent thread to run the login.                   |

### Core tier (`operatorCoreSlots`)

| Kind  | Name                     | What it adds                                  |
| ----- | ------------------------ | --------------------------------------------- |
| Event | `operator-input-asked`   | The thread holds a question for the operator. |
| Event | `operator-input-settled` | The question ended with one outcome.          |

### Client tier (`operatorClient`)

| Kind       | Name                     | What it adds                                          |
| ---------- | ------------------------ | ----------------------------------------------------- |
| Entry fold | `operatorRequestEntries` | Draws the ask card and its outcome in the transcript. |

`operatorClient` has no event hook.

### Control tier (`operatorControl`)

Empty. The plugin has no control hook and no control command.

## Usage

```ts
import { operatorClient } from '@dltech/atlas-plugin-operator/client'
import { operatorControl } from '@dltech/atlas-plugin-operator/control'
import { operatorCoreSlots } from '@dltech/atlas-plugin-operator/core'
import { operatorPod } from '@dltech/atlas-plugin-operator/pod'
import { definePlugin } from '@dltech/atlas-plugin-sdk'

definePlugin({
  name: 'operator',
  ...operatorCoreSlots,
  pod: operatorPod,
  control: operatorControl,
  client: operatorClient,
  transport: 'none',
})
```

## Rules

- The value never enters the transcript. `operator_input` returns the path of a file; read the value from that file and pass it to the command.
- The file is mode 0600. Do not copy the value into a command line, a message or a file of your own.
- Start the CLI with `bash` and `input` set to true before `operator_shell_input`. `input` runs it in the background. A shell that is gone makes the call fail.
- The call parks with no deadline. The turn resumes when the operator answers, cancels, or the session stops.
- Import `@dltech/atlas-plugin-operator/pod` in the pod only.

## See also

- [The v2 package map](../../docs/decisions/0019-v2-package-map.md)
- [`packages/plugin-sdk/src/slots.ts`](../../packages/plugin-sdk/src/slots.ts)
