import { HookChain, type HookChainArgs } from '@dltech/atlas-agent'
import { projectDirectoryOfState, type RecordEvent, type ToolDeclaration } from '@dltech/atlas-core'
import { mergeHooks, type PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { deferredListingHook } from './deferred-listing'
import { MirrorPlanHook } from './plan-mirror'
import { pluginResourcesClosedHook, pluginResourcesHook } from './plugin-resources'
import { ResourceSync } from './plugin-resource-sync'
import type { SessionRuntime } from './ports'
import type { SessionRecord } from './record/record-adapter'

export const hostHooksOf = (args: {
  declarations: () => readonly ToolDeclaration[]
}): HookChainArgs => ({
  beforeStep: [deferredListingHook({ declarations: args.declarations })],
  afterTool: [new MirrorPlanHook()],
})

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
