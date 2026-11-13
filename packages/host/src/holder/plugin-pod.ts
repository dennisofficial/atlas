import { HookChain, ToolRegistry, type HookChainArgs } from '@dltech/atlas-agent'
import {
  EModelFallbackReason,
  TEAMMATE_AGENT_TYPE,
  type EventDraft,
  type ThreadId,
  type ToolDeclaration,
  type ToolDefinition,
} from '@dltech/atlas-core'
import type { PluginPodContext, PodCrew } from '@dltech/atlas-plugin-sdk'

import { newKey } from '../calls/remote-calls'
import { worktreesOf } from './checkouts'
import type { HeldSessionDeps } from './held-session-deps'
import { fireLive } from './ports'
import { MirrorPlanHook } from './plan-mirror'
import { podControlOf } from './pod-control'
import { podSessionsOf } from './plugin-sessions'
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

const teammateFallbackOf = (args: {
  runtime: SessionRuntime
  teammateChoice: RoleModelChoice
  append: (drafts: readonly EventDraft[]) => Promise<void>
}): Pick<Parameters<typeof podSessionsOf>[0], 'onFallback'> => {
  const unavailable = args.teammateChoice.unavailable
  if (unavailable === undefined) return {}
  return {
    onFallback: (agentId) =>
      args.append([
        modelFellBackDraft({
          runtime: args.runtime,
          role: TEAMMATE_AGENT_TYPE,
          agentId,
          from: unavailable,
          to: args.teammateChoice.ref,
          reason: EModelFallbackReason.ProviderNotConnected,
        }),
      ]),
  }
}

export const pluginPodContextOf = (args: {
  deps: HeldSessionDeps
  runtime: SessionRuntime
  record: SessionRecord
  threadId: ThreadId
  signal: AbortSignal
  crew: PodCrew
}): PluginPodContext => {
  const { deps, runtime, record, threadId } = args
  const teammateChoice = runtime.choiceFor({
    role: { agentType: TEAMMATE_AGENT_TYPE },
    root: runtime.modelChoice,
  })
  const append = async (drafts: readonly EventDraft[]): Promise<void> => {
    await record.append({ threadId, runId: deps.ids.nextRunId(), drafts })
  }
  return {
    sessionId: deps.sessionId,
    workspaceDirectory: runtime.launchDirectory,
    control: podControlOf({
      client: deps.control,
      threadId,
      ...(deps.mcp === undefined ? {} : { mcp: deps.mcp(deps.sessionId) }),
    }),
    crew: args.crew,
    sessions: podSessionsOf({
      plane: deps.plane,
      sessionId: deps.sessionId,
      model: teammateChoice,
      ...teammateFallbackOf({ runtime, teammateChoice, append }),
    }),
    worktrees: worktreesOf({ calls: runtime.remoteCalls }),
    append,
    events: () => record.eventCache().eventsAfter(0),
    call: (op, options) =>
      runtime.remoteCalls.invoke({
        key: newKey(),
        op,
        signal: options?.signal,
        onOutput: options?.onOutput,
      }),
    live: (frame) => fireLive({ bus: deps.bus, sessionId: deps.sessionId, frame }),
    onDaemonEvent: (listener) => {
      const off = runtime.remoteCalls.onEvent(listener)
      args.signal.addEventListener('abort', off, { once: true })
      return off
    },
    log: (message) => deps.log?.info({ source: 'holder.plugin', message }),
    ...(runtime.env === undefined ? {} : { env: runtime.env }),
  }
}

export const pluginToolsOf = (args: {
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

export const hostHooksOf = (): HookChainArgs => ({ afterTool: [new MirrorPlanHook()] })

export const pluginHooksOf = (args: {
  runtime: SessionRuntime
  ctx: PluginPodContext
}): HookChain => {
  const { plugins } = args.runtime
  const host = hostHooksOf()
  if (plugins === undefined) return new HookChain(host)

  const plugin = plugins.pod.hooks(args.ctx)
  return new HookChain({
    ...host,
    ...plugin,
    afterTool: [...(host.afterTool ?? []), ...(plugin.afterTool ?? [])],
  })
}

export type PluginPod = { tools: ToolRegistry; hooks: HookChain }

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
    return { tools: args.runtime.tools, hooks: new HookChain(hostHooksOf()) }
  }
  const ctx = pluginPodContextOf(args)
  const tools = pluginToolsOf({ runtime: args.runtime, ctx })
  const hooks = pluginHooksOf({ runtime: args.runtime, ctx })
  ctx.onDaemonEvent((frame) => plugins.pod.onDaemonEvent(frame))
  return { tools, hooks }
}
