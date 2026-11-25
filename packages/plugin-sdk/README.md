# @dltech/atlas-plugin-sdk

The contract a plugin implements, and the composer that merges plugins into one session. A plugin
author reads this package first. Every plugin in `plugins/*` builds its slots with the types here.

## Owns

- The plugin shape: seven slots, `definePlugin` and the composer `composePlugins`.
- The pod tier: the pod context, the pod slot, its capabilities and pod resources; the control and
  client tier slot types.
- The capability types: crew, messages, classifier, analytics, sessions, worktrees, routines,
  subscriptions and MCP control, each with an `EMPTY_*` default.

## Does not own

- Which plugins load, and the call to the composer: the app registries under `apps/`.
- The event and view engines: `@dltech/atlas-core`.
- The command contract: `@dltech/atlas-commands`.

## Entry points

| Import                             | Use it for                                                |
| ---------------------------------- | --------------------------------------------------------- |
| `@dltech/atlas-plugin-sdk`         | The slots, `definePlugin`, `composePlugins` and types.    |
| `@dltech/atlas-plugin-sdk/testing` | A fixture plugin, and `podControlStub` for a plugin spec. |

## The slot contract

A plugin is a `definePlugin({...})` value with a `name` and all seven slots. A missing slot throws
`MissingPluginSlotError`, so a plugin cannot half-declare itself.

| Slot        | Type                        | What it carries                                         |
| ----------- | --------------------------- | ------------------------------------------------------- |
| `events`    | `readonly z.ZodType[]`      | The event bodies the plugin adds to the log schema.     |
| `views`     | `readonly PluginViewFold[]` | The fold from events to a view that a surface reads.    |
| `commands`  | `readonly Command[]`        | Session commands, built with `defineCommand`.           |
| `pod`       | `PodSlot`                   | Tools, hooks, prompt fragments, commands, resources.    |
| `control`   | `ControlSlot`               | Append hooks and control commands on the control plane. |
| `client`    | `ClientSlot`                | Client hooks that say which events a view cares about.  |
| `transport` | `'none'` or `'stream'`      | Whether the plugin needs a live stream to a surface.    |

A plugin usually splits its slots into tier files (`src/core`, `src/pod`, `src/control`,
`src/client`), each an export subpath, so a client bundle does not import pod code.

### The events slot

Each schema in `events` declares one event body. Add the body type to the `PluginEventBodies`
interface of `@dltech/atlas-core` with module augmentation beside the schema:

```ts
export type ProbeObserved = { type: 'probe-observed'; label: string }
declare module '@dltech/atlas-core' {
  interface PluginEventBodies {
    'probe-observed': ProbeObserved
  }
}
export const probeObservedSchema = z.object({
  type: z.literal('probe-observed'),
  label: z.string().min(1),
})
```

### The pod slot

A `PodSlot` declares:
- `tools(ctx)` and `hooks(ctx)`: the `ToolDefinition` values and the `HookChainArgs` of each phase.
  An `afterTool` hook may opt into captured file changes with `capturesFileChanges({call, signal})`
  and then read `result.fileChanges`; it may key its `additionalContext` to the call with
  `contextKey: call.callId`, so later findings do not supersede it.
- `prompts`: the `PromptFragment` values the plugin adds to the system prompt.
- `commands(ctx)`: a map from inbox kind to `CommandHandler`, each closing over the pod context; a duplicate kind throws.
- `resources`: the `PodResource` values the plugin loads, such as a skill directory.
- `slash(ctx)`: the `PodSlash` source (`names()`, `load({name, argumentText})`); at most one plugin.
- `childDeny`: tool names a sub-agent may not call.
- `onDaemonEvent(frame)` handles a daemon event; `onDaemonReady({ctx, hello})` runs once per boot.

`ctx` is a `PluginPodContext`. It gives `sessionId`, `workspaceDirectory`, `env()`, `append(drafts)`,
`notify(event, {key})`, `events()`, `call(op)`, `live(frame)`, `onDaemonEvent(listener)`, `log`, and
the capabilities `control`, `crew`, `messages`, `classifier`, `analytics`, `sessions`, `worktrees`,
`resources`. `ctx.analytics.capture({event, properties})` sends a product event for the session's
user; the host adds `session_id` and `thread_id`.
`ctx.crew` is a `PodCrew`: `spawn` with a `group` wakes the parent once, after every member ends,
`report({text})` answers the parent, and `say`, `stop`, `list` and `resume` act on one sub-agent.
`ctx.control` is a `PodControl`: `exposePort({port})`, `settingsVersions()`, `memory`,
`gateway` (`apiKey()`, `imageModel()`), `mcp`, `routines`, `subscriptions`.

### The control and client slots

`ControlSlot` holds `hooks` and `commands` (a map of control command handlers). An append hook runs
inside the append transaction. It receives a stamped `RecordEvent` and returns `Promise<void>`, so it
adds a transactional side effect. It cannot rewrite the event. `ClientSlot` holds `hooks` with a
`name` and an `appliesTo(event)` predicate, and optional `entryFolds`.

### Load a resource

A `PodResource<T>` needs a `name`, a `schema` and a `load({ctx, directory, signal})`. Five members are
optional: `watch(directory)` gives the roots and basenames to watch, `announce(value, ctx)` returns
the events to append, `stale(value)` says if the value is out of date, `background` starts the load
without blocking the step, and `cloud` names the settings it follows. To follow a cloud setting, set
`cloud: [ECloudSetting.McpServers]`, `ECloudSetting.Skills` or `ECloudSetting.PersonalInstructions`,
and compare `ctx.control.settingsVersions()` with `UNVERSIONED_SETTINGS`. Read the value with
`readResource({ctx, resource})`, and reload it with `ctx.resources.reload(name)`.

## Capabilities

- `definePlugin({name, ...slots})`, `Plugin`, `PluginSlots`: validate the slots and freeze them.
- `composePlugins(plugins)`: the `ComposedPlugins`. Two plugins may not register the same tool,
  prompt fragment, resource or command name. Collect `entryFolds` yourself, as
  `apps/web/src/features/sessions/registered-plugins.ts` does.
- `composePod(pods)`, `composePodCommands({factories, ctx})`: the merged pod slot and pod commands.
- `eventSchemaOf(plugins)`, `eventTypesOf(plugins)`: the decoder and the type list for a session.
- `crossLatch({ctx, name, level, mayFire})`: fire a level-triggered latch once, and record it.
- `MacOfflineError`, `PodMcpProxy*`, `McpToken` (`EMcpToken`): the Mac proxy and `mcp.token`.
- `EMPTY_*` (`EMPTY_POD`, `EMPTY_CLASSIFIER`, `EMPTY_ANALYTICS`, ...): the default a tier spreads.

## Usage

```ts
import { definePlugin, type PodSlot } from '@dltech/atlas-plugin-sdk'
import { shellsClient } from '@dltech/atlas-plugin-shells/client'
import { shellsControl } from '@dltech/atlas-plugin-shells/control'
import { shellsCoreSlots } from '@dltech/atlas-plugin-shells/core'
import { shellsPod } from '@dltech/atlas-plugin-shells/pod'

const shells = definePlugin({
  name: 'shells',
  ...shellsCoreSlots,
  pod: shellsPod satisfies PodSlot,
  control: shellsControl,
  client: shellsClient,
  transport: 'stream',
})
```

## Rules

- Declare all seven slots. Spread an `EMPTY_*` value instead of leaving one out.
- Give each tool, prompt fragment, resource and command a unique name; the composer throws on two.
- Import the pod tier in pod code only. It opens the session's sandbox and reads its files.
- Register a new plugin in every registry that composes it:
  - `apps/api/src/agent/registered-plugins.ts` (runtime).
  - `packages/pods/src/control/registered-plugins.ts` (control).
  - `apps/web/src/features/sessions/registered-plugins.ts` (web).
  - `apps/mobile/src/thread/session/registered-plugins.ts` (mobile, which builds its own schema).
  - `apps/tui/src/app/registered-plugins.ts` (tui).

## See also

- [docs/decisions/0019-v2-package-map.md](../../docs/decisions/0019-v2-package-map.md).
- `plugins/shells` for a full plugin with all four tiers.
