import { HookChain, ToolRegistry, type HookChainArgs } from '@dltech/atlas-agent'
import {
  projectDirectoryOfState,
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
  type PodSlash,
} from '@dltech/atlas-plugin-sdk'

import { deferredListingHook } from './deferred-listing'
import { withDiscoveryTools } from './discovery'
import type { HeldSessionDeps } from './held-session-deps'
import { MirrorPlanHook } from './plan-mirror'
import { pluginPodContextOf } from './plugin-context'
import { pluginResourcesClosedHook, pluginResourcesHook } from './plugin-resources'
import { ResourceSync } from './plugin-resource-sync'
import type { SessionRuntime } from './ports'
import type { SessionRecord } from './record/record-adapter'
import type { InFlightSteps } from '../calls/step-detach'

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

export { pluginPodContextOf, resolvedEventsOf } from './plugin-context'

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
    podReady: () =>
      (args.runtime.workspaceGate?.settled ?? 'prepared') === 'prepared' &&
      args.runtime.remoteCalls.linked(),
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
  const { plugins, hooks: session } = args.runtime
  const host = hostHooksOf({ declarations: args.declarations })
  if (plugins === undefined) {
    const merged = mergeHooks([host, session ?? {}])
    return new HookChain({
      ...merged,
      ...(args.runtime.trace === undefined ? {} : { trace: args.runtime.trace }),
    })
  }

  const plugin = plugins.pod.hooks(args.ctx)
  const resources = args.sync === undefined ? [] : [pluginResourcesHook({ sync: args.sync })]
  const closed = args.sync === undefined ? [] : [pluginResourcesClosedHook({ sync: args.sync })]
  const merged = mergeHooks([host, session ?? {}, plugin])
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
