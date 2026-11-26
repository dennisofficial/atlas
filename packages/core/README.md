# @dltech/atlas-core

Pure vocabulary and decisions shared by every Atlas package: ids, the event envelope, request
assembly, settings, ports, and the record folds. It imports `zod` and nothing else.

## Owns

- The ids and the event envelope, and the schema that decodes an event.
- The rules that assemble a model request, and the trace of that assembly.
- The settings definitions, the layers, their resolution, the port contracts and the port registry.
- The record folds: log, inbox, lease, durability, summary target, views and session status.
- The tool contract, the prompt fragment, the hook order, and the policy decisions.
- The context envelope, the compaction plan, the plan of a thread, the commands, the skills and the memory.
- The folds of the workspace, the pod, the services, the shells, the pull request and its GitHub schemas, the diff and the review.
- The notices, the subscriptions, the notify moment, the provider account and the usage window.

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
- `Event`, `EventDraft`, `RecordEvent`, `RecordEventBody`, `RecordBody`, `PluginEventBody`: the event and the draft.
- `chainEvents({threadId, runId, epoch, bodies, at})`: stamp bodies in order and chain them.
- `createRecordEventSchema({pluginBodies})`, `createEventBodySchema(...)`: the decoder for a log with plugins.
- `CORE_EVENT_TYPES`, `RECORD_ONLY_TYPES`: the types this package declares.

### Read the log

- `eventsOfType({events, type})`: the events of one type, narrowed.
- `openParkedCallsOf(events)`: the calls that still wait for a result.
- `latestResourceOf({events, resource})`: the newest value of a loaded resource.
- `recoverCall({facts, answer, bootId})`, `RecoverAction`, `planStep({scopeKey, recorded, consumed, op, digest, nextSlot})`, `StepFact`, `StepPlan`: what a new holder does with a call the log left open — ack, record, attach, run, rerun, interrupt, or `wait` — and how a tool call's daemon steps are named `<callId>.<n>`, reused only when op and digest match.
- `isDurable(type)`: whether a replay keeps that row. `summaryTargetOf({events, throughSeq})`: the range a summary can cover. `unfinishedCommandIdsOf(events)`, `COMMAND_OUTCOMES`: the consumed commands that still owe an outcome, which a new holder replays; a pane command owes one `command-applied`. `uploadPlacementsOf(facts)`, `placementFactOf({fileId, placement})`, `UPLOAD_PLACEMENT_KIND`: where a file a message carried sits in the sandbox, read from the log as a `fact-recorded` fact keyed `upload:<fileId>` and written back as one. `FactRecord`, `FactDraft`: that fact.

### Assemble the model request

- `assemble({rules, annotators, ctx})`: apply the rules in order and return `{ assembled, trace }`.
- `defineRule({name, apply})`, `defineAnnotator({name, apply})`: name one step of the pipeline.
- `defaultPipeline({...})`, `defaultRules(...)`, `defaultAnnotators()`: the pipeline Atlas uses.
- `ERuleFailurePolicy`, `EAssemblyStage`, `AssemblyTrace`: how the pipeline reports a failed rule.
- `Assembled`, `ProviderPrompt`, `Chunk`: the request a provider gets and the answer it streams back. `requestSizeOf({assembled, tools})` measures it in characters, and `contextBreakdownOf({sizes, inputTokens, outputTokens})` splits the reported tokens by that measure.

### Declare a tool

- `ToolDefinition`: abstract class with `name`, `description`, `effect`, `inputSchema`, `invoke`.
- `SchemaTool`: a `ToolDefinition` that parses its input against its schema.
- `EToolEffect`: `Read`, `Write`, `Destructive`. `ToolCall`, `ToolRun`: a call and its run.
- `ToolOutcome`, `ToolSpanDetail`, `ToolInvocation`, `ToolDeclaration`: result, span detail, call, model view.
- `typedDeferredInputOf({declaration, input})`, `toolJsonSchemaOf(declaration)`: the typed arguments of a deferred tool, and its JSON schema.

### Write a prompt fragment and order a hook

- `PromptFragment`: abstract class with `id`, `applies(ctx)`, `text(ctx)`. `PromptContext`: what it reads.
- `EHookPhase`, `EStage`, `orderHooks(hooks)`: the nine phases and the order inside a stage.
- `HookOutcome`, `hookOutcomeDrafts({hookName, outcome})`, `HOOK_CONTEXT_KEY`: what a hook hands back.
  `additionalContext` becomes a `context-loaded` event keyed by `contextKey` when the hook names one,
  so each finding stays current; `drafts` ride along untouched.
- `resolveBeforeTool({...})`, `EBeforeToolDecision`: the decision a tool hook returns.

### Resolve a setting

- `ESettingId`, `ATLAS_SETTINGS`, `SETTING_PAGES`: the catalogue of settings.
- `resolveSettings({...})`: the effective value of each setting, with the layer that won. `EConfigLayer`, `CONFIG_LAYER_ORDER`, `layeredByKey({layers, keyOf})` and `effectiveByKey({layers, keyOf})` layer any other domain by key, from built-in to repo, and name the layer that overrides an item.
- `toggleValueOf`, `choiceValueOf`, `textValueOf`: read one resolved value.

### Bind a port

- `EventLogPort`, `ModelPort`, `ProcessPort`, `FileSystemPort`, `ClockPort`, `ClassifierPort`: the contracts.
- `IdPort`, `CredentialPort`, `AccountStorePort`, `SecretsPort`, `NoticePort`, `DecisionPort`, `JudgePort`, `WorkspaceFactsPort`, `QualityReviewPort`, `AgentFileSystemPort`: the other contracts.
- `PortRegistryEntries`, `RegisteredPort`, `PortBindings`: the registry that a composition must fill.

### Describe a model, its spend, a secret, and an account

- `EModelRole`, `ModelCard`, `EEffort`: the model a role resolves to.
- `Account`, `accountOf`, `chooseAccount`, `refreshDecision`, `EAccountStatus`: the account a turn uses.
- `formatUtilization(value)`: a usage figure for the operator.
- `formatCountdown({ resetsAt, now })`: how long a usage window has left. `shownWindowsOf(usage)`: the plan windows to show; a weekly-only plan hides the 5-hour window.
- `UsageReport`: a reading and the time it was fetched, so a surface can show its age.
- `parseAnthropicUsage(body)`, `parseCodexUsage({ body, nowMs })`: the 5-hour and 7-day windows of a provider's plan usage body. A window the body does not state is `null`.
- `maskTypedSecret(value)`, `maskStoredSecret(value)`: a secret with its core hidden. `looksSecretShaped({path})`, `namesASecretLiteral({text})`: whether a path is a secret file (`.env`, a key, `.ssh`) or a text holds a key literal.

### Read the record and decide the next move

- `Lease`, `startVerdict({...})`, `claimGrant({...})`, `revoke({...})`: the lease rules.
- `consume({entry, seq})`, `InboxEntry`, `InboxRefusal`: the inbox rules. A consumed entry is refused.
- `decideHeldAction({...})`, `HeldOutcome`, `EExecutionLocation`: the host's next action. `resumePointOf({events})`, `EResumePoint`: how a stopped turn resumes, or the reason it cannot; `resumeMarkedDraft({...})` stamps the resume.
- `endingHeld({input, crew})`: whether a clean sub-agent ending waits for a sibling spawned in the same
  assistant step. `crew` holds `CrewRoomMember` values: `agentId`, `agentType`, `group` and `running`.
  `heldDraftOf({...})` stamps `held: true` on that ending, and `unheldDraftOf(draft)` strips it.
- `agent-spawned` carries the optional `group` that names its spawn step. A held `agent-ended` row carries `held: true`, and `isTurnTaking` is false for it. `isTeammateType(type)` names a teammate. `supersededEndingIds(events)` names the session-end stops that a later ending of the same agent replaces before the model's next step; the model fold and the transcript drop them.
- `routineFailureNotificationOf({routineId, routineName, reason, enabled, quiet, now})`: the push for a scheduled run that did not start, or `null` when settings keep it silent. Its `routineId` is the tap target.
- `credentialRepairOf({mainThreadId, events})`, `repairActionsOf({...})`, `ERepairAction`: the credential repair a session shows.

### Compact the log

- `compactionDisposition`, `ECompactionDisposition`, `compactionTarget`, `compactionWatermark`: what a compaction keeps, summarises and drops, and the range it covers.
- `planCompaction({events})`, `autoCompactAfterTurn`, `autoRotateAfterTurn`: the plan, and when the budget starts one.

### Read a derived view and the plan of a thread

- `deriveStatus`, `sessionViewOf`, `checkoutsOf`, `meterOf`, `failureMessageOf`: the views a surface shows.
- `EAgentStatus`, `EShellStatus`, `EServiceStatus`, `ESessionStatus`, `ETurnOutcome`: the states that the folds report. `sessionActivityOf(state)` and `ESessionActivity` say what a session status means (setup, a turn, a command such as summarise, a wait, or settled), and `isSettledStatus(state)` reads it.
- `foldPlan`, `planView`, `PLAN_TOOL_NAME`, `planReminder`: the plan a thread keeps.
- `COMMAND_CATALOGUE`, `commandLineOf`, `ECommandKind`: a slash command and its arguments.

### Name a file a spawn attaches

- `SpawnFile`: one file a spawn hands to the child, `{path, text}`.
- `contextFilePathOf({directory, relativePath})`: resolve a name under the context folder, or the reason to refuse it: absolute, `.`, `..`, an empty segment, or more than 200 characters.
- `spawnFilesRefusalOf(files)`: the reason a payload is unusable, or `null`. Text only: a NUL byte is refused.
- `SPAWN_FILES_MAX_COUNT` (32), `SPAWN_FILE_MAX_BYTES` (256 KB), `SPAWN_FILES_MAX_BYTES` (1 MB), `ATLAS_CONTEXT_DIR_ENV`: the limits and the folder variable.
- `attachedFilesLineOf(files)`, `spawnBriefOf({brief, files})`: the line that names the attached paths. `contextFileKindOf({path, head})`, `contextMediaKindOf(path)`, `contextMimeOf(path)`, `EContextFileKind`: whether a context file is text, an image, bytes, video or audio, and its media type. A mirrored file has no size limit.

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

- Import no Node module and no other Atlas package. The package has no filesystem, network, clock or randomness.
- Move a decision here when a test needs a mock. Test this code with plain data and no live model.

## See also

- [docs/core-contract.md](../../docs/core-contract.md) for the contract this package implements.
- [docs/architecture.md](../../docs/architecture.md) for the package boundaries.
- [docs/decisions/0019-v2-package-map.md](../../docs/decisions/0019-v2-package-map.md) for why the packages are split this way.
