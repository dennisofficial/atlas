import { HookChain, ToolRegistry, type HookChainArgs } from '@dltech/atlas-agent'
import {
  EModelFallbackReason,
  INBOX_KIND_EVENT,
  TEAMMATE_AGENT_TYPE,
  inboxEventPayloadOf,
  projectDirectoryOfState,
  type EventBody,
  type EventDraft,
  type ThreadId,
  type ToolDeclaration,
  type ToolDefinition,
  type RecordEvent,
} from '@dltech/atlas-core'
import {
  mergeHooks,
  type ComposedPod,
  type DaemonReady,
  type PluginPodContext,
  type PodCrew,
  type PodResources,
  type PodSlash,
} from '@dltech/atlas-plugin-sdk'

import { worktreesOf } from './checkouts'
import { deferredListingHook } from './deferred-listing'
import { withDiscoveryTools } from './discovery'
import type { HeldSessionDeps } from './held-session-deps'
import { fireLive } from './ports'
import { MirrorPlanHook } from './plan-mirror'
import { pluginCallOf } from './plugin-call'
import { podControlOf } from './pod-control'
import { pluginResourcesClosedHook, pluginResourcesHook, reloadResource } from './plugin-resources'
import { ResourceSync } from './plugin-resource-sync'
import { analyticsOf } from './pod-analytics'
import { podSessionsOf } from './plugin-sessions'
import { heldMessagesOf } from './pod-messages'
import { modelFellBackDraft } from './crew/model-fell-back'
import type { RoleModelChoice, SessionRuntime } from './ports'
import type { SessionRecord } from './record/record-adapter'

export class ComposedPodRegistry extends ToolRegistry {
  private readonly taken: ReadonlySet<string>
  private settled = false

  constructor(
    private readonly base: ToolRegistry,
    private readonly toolsOf: () => readonly ToolDefinition[],
    private readonly log: (message: string) => void = () => {},
  ) {
    super()
    this.taken = new Set(base.declarations().map((declaration) => declaration.name))
    this.extras()
  }

  declarations(): readonly ToolDeclaration[] {
    return [...this.base.declarations(), ...this.extras().values()]
  }

  find(name: string): ToolDefinition | undefined {
    return this.extras().get(name) ?? this.base.find(name)
  }

  private extras(): ReadonlyMap<string, ToolDefinition> {
    const byName = new Map<string, ToolDefinition>()
    for (const tool of this.toolsOf()) {
      if (!byName.has(tool.name) && !this.taken.has(tool.name)) {
        byName.set(tool.name, tool)
        continue
      }
      if (!this.settled) throw new Error(`two tools are registered as "${tool.name}"`)
      this.log(`dropped a duplicate tool "${tool.name}"`)
    }
    this.settled = true
    return byName
  }
}

const teammateModelOf =
  (runtime: SessionRuntime): (() => RoleModelChoice) =>
  () =>
    runtime.choiceFor({ role: { agentType: TEAMMATE_AGENT_TYPE }, root: runtime.modelChoice })

const teammateFallbackOf = (args: {
  runtime: SessionRuntime
  append: (drafts: readonly EventDraft[]) => Promise<void>
}): Pick<Parameters<typeof podSessionsOf>[0], 'onFallback'> => ({
  onFallback: async ({ agentId, model }) => {
    if (model.unavailable === undefined) return
    await args.append([
      modelFellBackDraft({
        runtime: args.runtime,
        role: TEAMMATE_AGENT_TYPE,
        agentId,
        from: model.unavailable,
        to: model.ref,
        reason: EModelFallbackReason.ProviderNotConnected,
      }),
    ])
  },
})

const podResourcesOf = (args: {
  runtime: SessionRuntime
  record: SessionRecord
  threadId: ThreadId
  ctx: () => PluginPodContext
}): PodResources => {
  const declared = args.runtime.plugins?.pod.resources ?? []
  return {
    reload: async (name) => {
      const resource = declared.find((candidate) => candidate.name === name)
      if (resource === undefined) return
      const state = await args.record.loopState({ threadId: args.threadId })
      await reloadResource({
        ctx: args.ctx(),
        resource,
        directory: projectDirectoryOfState({
          state,
          launchDirectory: args.runtime.launchDirectory,
        }),
      })
    },
  }
}

const postNoticeToSession = async (args: {
  deps: HeldSessionDeps
  event: EventBody
  key: string
}): Promise<void> => {
  await args.deps.plane.post({
    sessionId: args.deps.sessionId,
    kind: INBOX_KIND_EVENT,
    payload: inboxEventPayloadOf({ event: args.event, clientId: args.key }),
  })
}

export const resolvedEventsOf = (record: SessionRecord): readonly RecordEvent[] => {
  const cache = record.eventCache()
  return cache.eventsAfter(0).map((event) => cache.resolvedEvent(event))
}

export const pluginPodContextOf = (args: {
  deps: HeldSessionDeps
  runtime: SessionRuntime
  record: SessionRecord
  threadId: ThreadId
  signal: AbortSignal
  crew: PodCrew
  selfAgentId?: string | undefined
  notify?: ((event: EventBody, options: { key: string }) => Promise<void>) | undefined
}): PluginPodContext => {
  const { deps, runtime, record, threadId } = args
  const append = async (drafts: readonly EventDraft[]): Promise<void> => {
    await record.append({ threadId, runId: deps.ids.nextRunId(), drafts })
  }
  const ctx: PluginPodContext = {
    sessionId: deps.sessionId,
    workspaceDirectory: runtime.launchDirectory,
    control: podControlOf({
      client: deps.control,
      threadId,
      ...(deps.mcp === undefined ? {} : { mcp: deps.mcp(deps.sessionId) }),
    }),
    crew: args.crew,
    messages: heldMessagesOf({ deps, crew: args.crew, selfAgentId: args.selfAgentId }),
    classifier: {
      status: () => runtime.classifierStatus,
      classify: (args) => runtime.classifier.classify(args),
    },
    analytics: analyticsOf({ analytics: runtime.analytics, sessionId: deps.sessionId, threadId }),
    sessions: podSessionsOf({
      plane: deps.plane,
      sessionId: deps.sessionId,
      model: teammateModelOf(runtime),
      ...teammateFallbackOf({ runtime, append }),
      parkArchived: deps.parkArchived,
    }),
    worktrees: worktreesOf({
      calls: runtime.remoteCalls,
      ...(runtime.workspaceGate === undefined ? {} : { gate: runtime.workspaceGate }),
    }),
    append,
    notify: async (event, options) =>
      await (args.notify === undefined
        ? postNoticeToSession({ deps, event, key: options.key })
        : args.notify(event, options)),
    events: () => resolvedEventsOf(record),
    call: pluginCallOf({
      invoke: (call) => runtime.remoteCalls.invoke(call),
      ...(runtime.env === undefined ? {} : { env: runtime.env }),
      ...(runtime.workspaceGate === undefined ? {} : { gate: runtime.workspaceGate }),
    }),
    live: (frame) => fireLive({ bus: deps.bus, key: deps.sessionId, frame }),
    onDaemonEvent: (listener) => {
      const off = runtime.remoteCalls.onEvent(listener)
      args.signal.addEventListener('abort', off, { once: true })
      return off
    },
    log: (message) => deps.log?.info({ source: 'holder.plugin', message }),
    resources: podResourcesOf({ runtime, record, threadId, ctx: () => ctx }),
    ...(runtime.env === undefined ? {} : { env: runtime.env }),
  }
  return ctx
}

export const pluginToolsOf = (args: {
  runtime: SessionRuntime
  ctx: PluginPodContext
}): ToolRegistry => withDiscoveryTools(composedToolsOf(args))

const composedToolsOf = (args: {
  runtime: SessionRuntime
  ctx: PluginPodContext
}): ToolRegistry => {
  const { plugins } = args.runtime
  if (plugins === undefined) return args.runtime.tools
  return new ComposedPodRegistry(
    args.runtime.tools,
    () => plugins.pod.tools(args.ctx),
    args.ctx.log,
  )
}

export const resourceSyncOf = (args: {
  runtime: SessionRuntime
  ctx: PluginPodContext
  record: SessionRecord
  signal: AbortSignal
  shared?: (() => readonly RecordEvent[]) | undefined
}): ResourceSync | undefined => {
  const resources = args.runtime.plugins?.pod.resources ?? []
  if (resources.length === 0) return undefined
  const sync: ResourceSync = new ResourceSync({
    ctx: args.ctx,
    resources,
    directory: () =>
      projectDirectoryOfState({
        state: args.record.eventCache().loopState(),
        launchDirectory: args.runtime.launchDirectory,
      }),
    trace: args.runtime.trace,
    shared: args.shared,
    reconnect: (listener) =>
      args.runtime.remoteCalls.onReady((hello) => {
        listener({ restart: hello.restart })
      }),
    signal: args.signal,
  })
  sync.start()
  return sync
}

export const watchDaemonReady = (args: {
  onReady: SessionRuntime['remoteCalls']['onReady']
  bootId: () => string | undefined
  pod: Pick<ComposedPod, 'onDaemonReady'>
  ctx: PluginPodContext
  signal: AbortSignal
}): void => {
  let announced: string | undefined
  const announce = (hello: DaemonReady): void => {
    if (hello.bootId === announced) return
    announced = hello.bootId
    args.pod.onDaemonReady({ ctx: args.ctx, hello })
  }
  const offReady = args.onReady(announce)
  args.signal.addEventListener('abort', offReady, { once: true })
  const booted = args.bootId()
  if (booted !== undefined) announce({ bootId: booted, restart: false })
}

export const hostHooksOf = (args: {
  declarations: () => readonly ToolDeclaration[]
}): HookChainArgs => ({
  beforeStep: [deferredListingHook({ declarations: args.declarations })],
  afterTool: [new MirrorPlanHook()],
})

export const pluginHooksOf = (args: {
  runtime: SessionRuntime
  ctx: PluginPodContext
  declarations: () => readonly ToolDeclaration[]
  sync?: ResourceSync | undefined
}): HookChain => {
  const { plugins } = args.runtime
  const host = hostHooksOf({ declarations: args.declarations })
  if (plugins === undefined) return new HookChain(host)

  const plugin = plugins.pod.hooks(args.ctx)
  const resources = args.sync === undefined ? [] : [pluginResourcesHook({ sync: args.sync })]
  const closed = args.sync === undefined ? [] : [pluginResourcesClosedHook({ sync: args.sync })]
  const merged = mergeHooks([host, plugin])
  return new HookChain({
    ...merged,
    beforeTurn: [...resources, ...(merged.beforeTurn ?? [])],
    afterTurn: [...closed, ...(merged.afterTurn ?? [])],
    trace: args.runtime.trace,
    onMishap: (mishap) => args.ctx.log(`hook ${mishap.label} ${mishap.kind}: ${mishap.detail}`),
  })
}

export type PluginPod = {
  tools: ToolRegistry
  hooks: HookChain
  slash?: PodSlash | undefined
  ctx?: PluginPodContext | undefined
}

export const pluginPodOf = (args: {
  deps: HeldSessionDeps
  runtime: SessionRuntime
  record: SessionRecord
  threadId: ThreadId
  signal: AbortSignal
  crew: PodCrew
}): PluginPod => {
  const { plugins } = args.runtime
  if (plugins === undefined) {
    const tools = withDiscoveryTools(args.runtime.tools)
    const hooks = new HookChain(hostHooksOf({ declarations: () => tools.declarations() }))
    return { tools, hooks }
  }
  const ctx = pluginPodContextOf(args)
  watchDaemonReady({
    onReady: (listener) => args.runtime.remoteCalls.onReady(listener),
    bootId: () => args.runtime.remoteCalls.bootId(),
    pod: plugins.pod,
    ctx,
    signal: args.signal,
  })
  const tools = pluginToolsOf({ runtime: args.runtime, ctx })
  const slash = plugins.pod.slash(ctx)
  const sync = resourceSyncOf({
    runtime: args.runtime,
    ctx,
    record: args.record,
    signal: args.signal,
  })
  const hooks = pluginHooksOf({
    runtime: args.runtime,
    ctx,
    declarations: () => tools.declarations(),
    ...(sync === undefined ? {} : { sync }),
  })
  ctx.onDaemonEvent((frame) => plugins.pod.onDaemonEvent(frame))
  return { tools, hooks, ctx, ...(slash === undefined ? {} : { slash }) }
}
