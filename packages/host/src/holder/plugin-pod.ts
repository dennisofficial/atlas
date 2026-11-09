import { HookChain, ToolRegistry } from '@dltech/atlas-agent'
import type { ThreadId, ToolDeclaration, ToolDefinition } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { newKey } from '../calls/remote-calls'
import type { HeldSessionDeps } from './held-session-deps'
import { podControlOf } from './pod-control'
import type { SessionRuntime } from './ports'
import type { SessionRecord } from './record/record-adapter'

class ExtendedToolRegistry extends ToolRegistry {
  private readonly extras: ReadonlyMap<string, ToolDefinition>

  constructor(
    private readonly base: ToolRegistry,
    extras: readonly ToolDefinition[],
  ) {
    super()
    const byName = new Map<string, ToolDefinition>()
    for (const tool of extras) {
      if (byName.has(tool.name) || base.find(tool.name) !== undefined) {
        throw new Error(`two tools are registered as "${tool.name}"`)
      }
      byName.set(tool.name, tool)
    }
    this.extras = byName
  }

  declarations(): readonly ToolDeclaration[] {
    return [...this.base.declarations(), ...this.extras.values()]
  }

  find(name: string): ToolDefinition | undefined {
    return this.extras.get(name) ?? this.base.find(name)
  }
}

const contextOf = (args: {
  deps: HeldSessionDeps
  runtime: SessionRuntime
  record: SessionRecord
  threadId: ThreadId
  signal: AbortSignal
}): PluginPodContext => {
  const { deps, runtime, record, threadId } = args
  return {
    sessionId: deps.sessionId,
    control: podControlOf({ client: deps.control, threadId }),
    append: async (drafts) => {
      await record.append({ threadId, runId: deps.ids.nextRunId(), drafts })
    },
    events: () => record.eventCache().eventsAfter(0),
    call: (op, options) =>
      runtime.remoteCalls.invoke({
        key: newKey(),
        op,
        signal: options?.signal,
        onOutput: options?.onOutput,
      }),
    onDaemonEvent: (listener) => {
      const off = runtime.remoteCalls.onEvent(listener)
      args.signal.addEventListener('abort', off, { once: true })
      return off
    },
    log: (message) => deps.log?.info({ source: 'holder.plugin', message }),
  }
}

export type PluginPod = { tools: ToolRegistry; hooks: HookChain }

export const pluginPodOf = (args: {
  deps: HeldSessionDeps
  runtime: SessionRuntime
  record: SessionRecord
  threadId: ThreadId
  signal: AbortSignal
}): PluginPod => {
  const { plugins } = args.runtime
  if (plugins === undefined) return { tools: args.runtime.tools, hooks: new HookChain({}) }
  const ctx = contextOf(args)
  const pod = plugins.pod
  const tools = new ExtendedToolRegistry(args.runtime.tools, pod.tools(ctx))
  const hooks = new HookChain(pod.hooks(ctx))
  ctx.onDaemonEvent((frame) => pod.onDaemonEvent(frame))
  return { tools, hooks }
}
