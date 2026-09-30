import {
  EMessageOrigin,
  saidBody,
  type AssemblyPipeline,
  type EventDraft,
  type EventLogPort,
  type ModelPort,
  type ProviderIdentity,
  type TelemetryPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { SteerMessage } from './child-state'
import { combineInput, type InputBatch } from '../../intake/input-batch'
import type { MessageIntake } from '../../intake/message-intake'
import type { ThreadModel } from '../../store/thread-store'
import type { DeltaChannel } from '../../channel/delta-channel'
import { PublishingTurnRunner } from '../../channel/publishing-turn-runner'
import { withoutSpawnableListing } from '../../tools/builtin/agent-spawn'
import type { HookChain } from '../../hooks/registry'
import type { PendingDrain, TurnDeps } from '../../loop/run-turn'
import type { TurnRunner } from '../../loop/turn-runner.port'
import { ObservingToolDispatcher } from '../../telemetry/observing-dispatcher'
import { HookedToolDispatcher } from '../../tools/dispatch'
import { filteredToolRegistry, type ToolRegistry } from '../../tools/registry'
import {
  AGENT_TOOL_NAMES,
  isTeammateType,
  SERVICE_CONTROL_TOOL_NAMES,
  TEAMMATE_AGENT_TYPE,
  WORKTREE_TOOL_NAMES,
  toolRegistryFor,
  type AgentType,
} from '../types'

export type ChildRunnerDeps = {
  turn: Omit<TurnDeps, 'drainPending'>
  tools: ToolRegistry
  hooks: HookChain
  channel: DeltaChannel
  assemblyFor: (args: {
    agentType: AgentType
    model: ModelPort
    projectDirectory?: string | undefined
  }) => AssemblyPipeline
  drainNotices: (args: { threadId: ThreadId }) => Promise<PendingDrain>
  intake?: MessageIntake | undefined
  modelFor?: ((args: { agentType: AgentType; threadId: ThreadId }) => ModelPort | Promise<ModelPort>) | undefined
  modelAtSpawn?: ((args: { agentType: AgentType; spawnedBy: ThreadId }) => Promise<ThreadModel>) | undefined
  telemetry?: TelemetryPort | undefined
}

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
    refresh: (args) => log.refresh(args),
    head: (args) => log.head(args),
    readOwn: (args) => log.readOwn(args),
    replace: (args) => log.replace(args),
  }
}

export type ChildRunnerSource = (args: ChildRunnerRequest) => TurnRunner | Promise<TurnRunner>

export type ChildRunnerRequest = {
  agentType: AgentType
  threadId: ThreadId
  projectDirectory: string | undefined
  observe: (drafts: readonly EventDraft[]) => void
  observeContext: (args: { tokens: number; window: number }) => void
  observeModel: (model: ProviderIdentity) => void
  steering: () => SteeringBatch
}

export type SteeringBatch = {
  peek: () => readonly SteerMessage[]
  acknowledge: () => void
  release?: (() => void) | undefined
}

export const drainedSteering = (drain: () => readonly SteerMessage[]): SteeringBatch => {
  const held = drain()
  return {
    peek: () => held,
    acknowledge: () => undefined,
  }
}

const peekSteering = (steering: () => SteeringBatch): (() => InputBatch) => {
  let held: SteeringBatch | undefined
  return () => {
    const batch = held ?? steering()
    held = batch
    const peeked = batch.peek()
    return {
      drafts: steerDrafts(peeked),
      wakesTurn: peeked.length > 0,
      acknowledge: () => {
        batch.acknowledge()
        held = undefined
      },
      ...(batch.release === undefined
        ? {}
        : {
            release: () => {
              batch.release?.()
              held = undefined
            },
          }),
    }
  }
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
    ...saidBody({ text: one.text, images: one.images, files: one.files }),
    via: one.via ?? EMessageOrigin.ParentAgent,
  }))

export async function buildChildRunner({
  deps,
  agentType,
  threadId,
  projectDirectory,
  observe,
  observeContext,
  observeModel,
  steering,
}: ChildRunnerRequest & { deps: ChildRunnerDeps }): Promise<TurnRunner> {
  const steeringBatch = peekSteering(steering)
  const narrowed = filteredToolRegistry({
    registry: toolRegistryFor({ registry: deps.tools, agentType }),
    deny: deniedFor(agentType),
  })
  const registry = isTeammateType(agentType.name)
    ? withoutSpawnableListing({ registry: narrowed, hidden: [TEAMMATE_AGENT_TYPE] })
    : narrowed
  const { turn } = deps
  const model = deps.modelFor === undefined ? turn.model : await deps.modelFor({ agentType, threadId })
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
      dispatch: new ObservingToolDispatcher({
        inner: new HookedToolDispatcher({
          registry,
          hooks: deps.hooks,
          logPort: turn.logPort,
        }),
        telemetry: deps.telemetry,
      }),
      assembly: deps.assemblyFor({ agentType, model, projectDirectory }),
      drainPending: async (args) => {
        const notices = await deps.drainNotices(args)
        const batch = combineInput([
          steeringBatch(),
          {
            drafts: notices.drafts,
            wakesTurn: notices.wakesTurn,
            acknowledge: () => notices.acknowledge?.(),
            ...(notices.release === undefined ? {} : { release: () => notices.release?.() }),
          },
        ])
        return {
          drafts: batch.drafts,
          wakesTurn: batch.wakesTurn,
          acknowledge: batch.acknowledge,
          release: () => batch.release?.(),
        }
      },
    },
  })
}
