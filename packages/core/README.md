# @dltech/atlas-core

Pure vocabulary and decisions shared by every v2 package: ids, the event envelope, request
assembly, settings, ports, and the record folds. It imports `zod` and nothing else.

## Owns

- The ids and the event envelope, and the schema that decodes an event.
- The rules that assemble a model request, and the trace of that assembly.
- The settings definitions, the layers, and their resolution.
- The port contracts and the port registry.
- The record folds: log, inbox, lease, views and session status.
- The tool contract, the prompt fragment, the hook order, and the policy decisions.

## Does not own

- The loop that runs a turn: `@dltech/atlas-agent`.
- The wire schemas of the daemon and the API: `@dltech/atlas-protocol`.
- The plugin contract: `@dltech/atlas-plugin-sdk`.
- Storage and the control plane: `@dltech/atlas-control`.

## Entry points

| Import               | Use it for                                         |
| -------------------- | -------------------------------------------------- |
| `@dltech/atlas-core` | The full pure surface. The package has no subpath. |

## Capabilities

### Name an id and build an event

- `toThreadId(value)`, `toRunId(value)`, `toCallId(value)`, `toEventId(value)`: brand a string.
- `Event`, `EventDraft`, `V2Event`, `PluginEventBody`: the stamped event and the draft.
- `chainEvents({threadId, runId, epoch, bodies, at})`: stamp bodies in order and chain them.
- `createV2EventSchema({pluginBodies})`, `createEventBodySchema(...)`: the decoder for a log that
  holds plugin events.
- `CORE_EVENT_TYPES`, `RECORD_ONLY_TYPES`: the types this package declares.

### Read the log

- `eventsOfType({events, type})`: the events of one type, narrowed.
- `openParkedCallsOf(events)`: the calls that still wait for a result.
- `latestResourceOf({events, resource})`: the newest value of a loaded resource.

### Assemble the model request

- `assemble({rules, annotators, ctx})`: apply the rules in order and return `{ assembled, trace }`.
- `defineRule({name, apply})`, `defineAnnotator({name, apply})`: name one step of the pipeline.
- `defaultPipeline({...})`, `defaultRules(...)`, `defaultAnnotators()`: the pipeline Atlas uses.
- `ERuleFailurePolicy`, `EAssemblyStage`, `AssemblyTrace`: how the pipeline handles and reports a
  failed rule.

### Declare a tool

- `ToolDefinition`: abstract class with `name`, `description`, `effect`, `inputSchema`, `invoke`.
- `SchemaTool`: a `ToolDefinition` that parses its input against its schema.
- `EToolEffect`: `Read`, `Write`, `Destructive`.
- `ToolOutcome`, `ToolInvocation`, `ToolDeclaration`: the result, the call, and what the model sees.
- `typedDeferredInputOf({declaration, input})`: restore the JSON types of a deferred tool's
  arguments from its schema. `toolJsonSchemaOf(declaration)`: the JSON schema of a declaration.

### Write a prompt fragment and order a hook

- `PromptFragment`: abstract class with `id`, `applies(ctx)`, `text(ctx)`.
- `PromptContext`: the data a fragment reads.
- `EHookPhase`, `EStage`, `orderHooks(hooks)`: the nine phases and the order inside a stage.
- `resolveBeforeTool({...})`, `EBeforeToolDecision`: the decision a tool hook returns.

### Resolve a setting

- `ESettingId`, `ATLAS_SETTINGS`, `SETTING_PAGES`: the catalogue of settings.
- `resolveSettings({...})`: the effective value of each setting, with the layer that won.
- `toggleValueOf`, `choiceValueOf`, `textValueOf`: read one resolved value.

### Bind a port

- `EventLogPort`, `ModelPort`, `ProcessPort`, `FileSystemPort`, `ClockPort`, `ClassifierPort`: the
  contracts.
- `PortRegistryEntries`, `RegisteredPort`, `PortBindings`: the registry that a composition must fill.

### Describe a model, its spend, and a secret

- `EModelRole`, `ModelCard`, `EEffort`: the model a role resolves to.
- `formatUtilization(value)`: a usage figure for the operator.
- `parseAnthropicUsage(body)`, `parseCodexUsage({ body, nowMs })`: the 5-hour and 7-day windows of
  a provider's plan usage body. A window the body does not state is `null`.
- `maskTypedSecret(value)`, `maskStoredSecret(value)`: a secret with its core hidden.

### Read the record and decide the next move

- `Lease`, `startVerdict({...})`, `claimGrant({...})`, `revoke({...})`: the lease rules.
- `consume({entry, seq})`, `takeBack(entry)`, `InboxEntry`: the inbox rules.
- `decideHeldAction({...})`, `HeldOutcome`, `EExecutionLocation`: the host's next action.
- `credentialRepairOf({mainThreadId, events})`, `repairActionsOf({...})`, `ERepairAction`: the
  credential repair a session shows, and what it offers.

### Name a file a spawn attaches

- `SpawnFile`: one file a spawn hands to the child, `{path, text}`.
- `contextFilePathOf({directory, relativePath})`: resolve a name under the context folder, or the
  reason to refuse it (absolute, `~`, `$`, `\`, `.`, `..`, empty segment, `.git`, over 200
  characters).
- `spawnFilesRefusalOf(files)`: the reason a payload is unusable, or `null`. Text only: a NUL byte
  is refused.
- `SPAWN_FILES_MAX_COUNT` (32), `SPAWN_FILE_MAX_BYTES` (256 KB), `SPAWN_FILES_MAX_BYTES` (1 MB),
  `ATLAS_CONTEXT_DIR_ENV`: the limits and the variable that names the folder.
- `attachedFilesLineOf(files)`, `spawnBriefOf({brief, files})`: the line that names the attached
  paths in the child's first message.

## Usage

```ts
import { chainEvents, toRunId, toThreadId } from '@dltech/atlas-core'

const [event] = chainEvents({
  threadId: toThreadId('thread-1'),
  runId: toRunId('run-1'),
  epoch: 1,
  at: '2026-11-02T12:00:00.000Z',
  bodies: [{ type: 'user-said', text: 'hi' }],
})
```

## Rules

- Import no Node module and no other Atlas package. The package has no filesystem, network, clock
  or randomness.
- Move a decision here when a test needs a mock. Test this code with plain data and no live model.

## See also

- [docs/core-contract.md](../../docs/core-contract.md) for the contract this package implements.
- [docs/architecture.md](../../docs/architecture.md) for the package boundaries.
- [docs/decisions/0019-v2-package-map.md](../../docs/decisions/0019-v2-package-map.md) for why the
  packages are split this way.
