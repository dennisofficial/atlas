import { HookChain, ToolRegistry } from '@dltech/atlas-agent'
import {
  EModelFallbackReason,
  TEAMMATE_AGENT_TYPE,
  projectDirectoryOfState,
  type EventBody,
  type EventDraft,
  type PluginEventBody,
  type RecordBody,
  type RecordEvent,
  type ThreadId,
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
import { ComposedPodRegistry } from './composed-registry'
import { modelFellBackDraft } from './crew/model-fell-back'
import { withDiscoveryTools } from './discovery'
import type { HeldSessionDeps } from './held-session-deps'
import { fireLive } from './ports'
import { pluginCallOf } from './plugin-call'
import { hostHooksOf, pluginHooksOf, resourceSyncOf } from './plugin-hooks'
import { podControlOf } from './pod-control'
import { reloadResource } from './plugin-resources'
import { analyticsOf, threadKindOf } from './pod-analytics'
import { postNoticeToSession } from './pod-notice'
import { podSessionsOf } from './plugin-sessions'
import { heldMessagesOf } from './pod-messages'
import type { RoleModelChoice, SessionRuntime } from './ports'
import type { SessionRecord } from './record/record-adapter'
import { recordStep, recordedStepsOf } from './record/call-steps'
import { hostStepOf } from './record/host-step'
import type { InFlightSteps } from '../calls/step-detach'

const teammateModelOf =
  (runtime: SessionRuntime): (() => RoleModelChoice) =>
  () =>
    runtime.choiceFor({ role: { agentType: TEAMMATE_AGENT_TYPE }, root: runtime.modelChoice })

const fellBackAlready = (args: { record: SessionRecord; agentId: ThreadId }): boolean =>
  args.record
    .eventCache()
    .eventsAfter(0)
    .some((event) => event.type === 'model-fell-back' && event.agentId === args.agentId)

const teammateFallbackOf = (args: {
  runtime: SessionRuntime
  append: (drafts: readonly EventDraft[]) => Promise<void>
  fellBackAlready: (agentId: ThreadId) => boolean
}): Pick<Parameters<typeof podSessionsOf>[0], 'onFallback'> => ({
  onFallback: async ({ agentId, model }) => {
    if (model.unavailable === undefined) return
    if (args.fellBackAlready(agentId)) return
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

type PodDraft = EventDraft | RecordBody | PluginEventBody

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
  steps?: InFlightSteps | undefined
  notify?: ((event: EventBody, options: { key: string }) => Promise<void>) | undefined
}): PluginPodContext => {
  const { deps, runtime, record, threadId } = args
  const step = async (request: { op: string; input: object }) =>
    await hostStepOf({
      record,
      threadId,
      runId: () => deps.ids.nextRunId(),
      op: request.op,
      input: request.input,
    })
  const append = async (drafts: readonly PodDraft[]): Promise<void> => {
    const bookkeeping = record.eventCache().bookkeeping()
    const fresh = drafts.filter(
      (draft) => draft.type !== 'fact-recorded' || !bookkeeping.fact(draft.key).found,
    )
    if (fresh.length === 0) return
    await record.append({ threadId, runId: deps.ids.nextRunId(), drafts: fresh })
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
    messages: heldMessagesOf({
      deps,
      crew: args.crew,
      step,
      ...(args.selfAgentId === undefined ? {} : { selfAgentId: args.selfAgentId }),
    }),
    classifier: {
      status: () => runtime.classifierStatus,
      classify: (args) => runtime.classifier.classify(args),
    },
    analytics: analyticsOf({
      analytics: runtime.analytics,
      sessionId: deps.sessionId,
      threadId,
      threadKind: threadKindOf({ selfAgentId: args.selfAgentId, agents: args.crew.list() }),
    }),
    sessions: podSessionsOf({
      plane: deps.plane,
      sessionId: deps.sessionId,
      threadId,
      step,
      model: teammateModelOf(runtime),
      ...teammateFallbackOf({
        runtime,
        append,
        fellBackAlready: (agentId) => fellBackAlready({ record, agentId }),
      }),
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
      steps: {
        recorded: (scopeKey) => recordedStepsOf({ record, scopeKey }),
        record: (step) => recordStep({ record, threadId, runId: deps.ids.nextRunId(), step }),
      },
      bootId: () => runtime.remoteCalls.bootId(),
      ack: (key) => runtime.remoteCalls.ack({ key }),
      ...(args.steps === undefined ? {} : { onStep: (event) => args.steps?.apply(event) }),
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
  steps?: InFlightSteps | undefined
}): PluginPod => {
  const { plugins } = args.runtime
  if (plugins === undefined) {
    const tools = withDiscoveryTools(args.runtime.tools)
    const host = hostHooksOf({ declarations: () => tools.declarations() })
    const merged = mergeHooks([host, args.runtime.hooks ?? {}])
    const hooks = new HookChain({
      ...merged,
      ...(args.runtime.trace === undefined ? {} : { trace: args.runtime.trace }),
    })
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
