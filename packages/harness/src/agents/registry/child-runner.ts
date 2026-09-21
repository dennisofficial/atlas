import {
  EMessageOrigin,
  type AssemblyPipeline,
  type EventDraft,
  type EventLogPort,
  type ModelPort,
  type ProviderIdentity,
  type ThreadId,
} from '@dltech/atlas-core'

import type { SteerMessage } from './child-state'
import type { DeltaChannel } from '../../channel/delta-channel'
import { PublishingTurnRunner } from '../../channel/publishing-turn-runner'
import type { HookChain } from '../../hooks/registry'
import type { TurnDeps } from '../../loop/run-turn'
import type { TurnRunner } from '../../loop/turn-runner.port'
import { EApprovalRouting, HookedToolDispatcher } from '../../tools/dispatch'
import { filteredToolRegistry, type ToolRegistry } from '../../tools/registry'
import {
  AGENT_TOOL_NAMES,
  isTeammateType,
  SERVICE_CONTROL_TOOL_NAMES,
  WORKTREE_TOOL_NAMES,
  toolRegistryFor,
  type AgentType,
} from '../types'

export type ChildRunnerDeps = {
  turn: Omit<TurnDeps, 'drainPending'>
  tools: ToolRegistry
  hooks: HookChain
  /**
   * The same channel the root thread publishes on. A child publishes under its own `threadId`, so a
   * reader subscribed to the child sees its steps stream and nobody subscribed to the parent sees
   * anything — which is the delegate's-work-is-counted-never-quoted rule holding at the transport.
   */
  channel: DeltaChannel
  assemblyFor: (args: {
    agentType: AgentType
    projectDirectory?: string | undefined
  }) => AssemblyPipeline
  drainNotices: (args: { threadId: ThreadId }) => Promise<readonly EventDraft[]>
  modelFor?: ((args: { agentType: AgentType }) => ModelPort) | undefined
}

/**
 * tsyringe resolves constructor dependencies eagerly, and `agent_spawn` is a ToolDefinition the
 * ToolRegistry constructs, so resolving a child's tools while building the supervisor closes a
 * cycle. Nothing here is resolved until a spawn calls it.
 */
export type ChildRunnerDepsSource = () => ChildRunnerDeps

const SUB_AGENT_DENIED: readonly string[] = [
  ...AGENT_TOOL_NAMES,
  ...WORKTREE_TOOL_NAMES,
  ...SERVICE_CONTROL_TOOL_NAMES,
]

const deniedFor = (agentType: AgentType): readonly string[] =>
  isTeammateType(agentType.name) ? SERVICE_CONTROL_TOOL_NAMES : SUB_AGENT_DENIED

function observingLog({
  log,
  threadId,
  observe,
}: {
  log: EventLogPort
  threadId: ThreadId
  observe: (drafts: readonly EventDraft[]) => void
}): EventLogPort {
  return {
    async append(args) {
      if (args.threadId === threadId) observe(args.drafts)
      return log.append(args)
    },

    read: (args) => log.read(args),
    head: (args) => log.head(args),
    readOwn: (args) => log.readOwn(args),
    replace: (args) => log.replace(args),
  }
}

export type ChildRunnerSource = (args: ChildRunnerRequest) => TurnRunner

export type ChildRunnerRequest = {
  agentType: AgentType
  threadId: ThreadId
  projectDirectory: string | undefined
  observe: (drafts: readonly EventDraft[]) => void
  observeContext: (args: { tokens: number; window: number }) => void
  observeModel: (model: ProviderIdentity) => void
  steering: () => readonly SteerMessage[]
}

export function childRunnerSource({ deps }: { deps: ChildRunnerDepsSource }): ChildRunnerSource {
  let resolved: ChildRunnerDeps | undefined

  return (request) => {
    const held = resolved ?? deps()
    resolved = held
    return buildChildRunner({ ...request, deps: held })
  }
}

export const steerDrafts = (said: readonly SteerMessage[]): readonly EventDraft[] =>
  said.map((one) => ({
    type: 'user-said',
    text: one.text,
    via: one.via ?? EMessageOrigin.ParentAgent,
    ...(one.images === undefined || one.images.length === 0 ? {} : { images: one.images }),
  }))

export function buildChildRunner({
  deps,
  agentType,
  threadId,
  projectDirectory,
  observe,
  observeContext,
  observeModel,
  steering,
}: ChildRunnerRequest & { deps: ChildRunnerDeps }): TurnRunner {
  const registry = filteredToolRegistry({
    registry: toolRegistryFor({ registry: deps.tools, agentType }),
    deny: deniedFor(agentType),
  })
  const { turn } = deps
  const model = deps.modelFor === undefined ? turn.model : deps.modelFor({ agentType })
  observeModel(model.identity)

  return new PublishingTurnRunner({
    channel: deps.channel,
    deps: {
      ...turn,
      launchDirectory: projectDirectory ?? turn.launchDirectory,
      log: observingLog({ log: turn.log, threadId, observe }),
      onContext: observeContext,
      model,
      tools: () => registry.declarations(),
      dispatch: new HookedToolDispatcher({
        registry,
        hooks: deps.hooks,
        approvals: EApprovalRouting.None,
      }),
      assembly: deps.assemblyFor({ agentType, projectDirectory }),
      drainPending: async (args) => [...steerDrafts(steering()), ...(await deps.drainNotices(args))],
    },
  })
}
