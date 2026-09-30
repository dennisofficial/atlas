import type {
  ClockPort,
  EventLogPort,
  ExecutionLocationSinkPort,
  IdPort,
  ThreadId,
} from '@dltech/atlas-core'
import { parseRef } from '@dltech/atlas-core'

import type { ThreadStorePort } from '../../store'
import { isTeammateType, type AgentType } from '../types'
import { freshChild, snapshotOf } from './child-state'
import type { ChildSteps } from './child-steps'
import { agentTypeNamed, type SupervisorDeps } from './deps'
import { openChildThread } from './open-child'
import type { AgentOutcome } from './port'
import { EMPTY_BRIEF, TEAMMATE_FROM_MAIN_ONLY, unknownAgentType } from './reasons'
import type { AgentRoster } from './roster'
import { childDirectory } from './relocate-children'

export class ChildSpawner {
  private readonly threads: ThreadStorePort
  private readonly log: EventLogPort
  private readonly ids: IdPort
  private readonly clock: ClockPort
  private readonly roster: AgentRoster
  private readonly steps: ChildSteps
  private readonly agentTypes: readonly AgentType[]
  private readonly sink: ExecutionLocationSinkPort
  private readonly deps: SupervisorDeps

  constructor(args: {
    threads: ThreadStorePort
    log: EventLogPort
    ids: IdPort
    clock: ClockPort
    roster: AgentRoster
    steps: ChildSteps
    agentTypes: readonly AgentType[]
    sink: ExecutionLocationSinkPort
    deps: SupervisorDeps
  }) {
    this.threads = args.threads
    this.log = args.log
    this.ids = args.ids
    this.clock = args.clock
    this.roster = args.roster
    this.steps = args.steps
    this.agentTypes = args.agentTypes
    this.sink = args.sink
    this.deps = args.deps
  }

  async spawn({
    threadId,
    agentType,
    brief,
    intent,
  }: {
    threadId: ThreadId
    agentType: string
    brief: string
    intent: string
  }): Promise<AgentOutcome> {
    const type = agentTypeNamed({ agentTypes: this.agentTypes, name: agentType })
    if (type === undefined) {
      return { ok: false, reason: unknownAgentType({ agentType, known: this.agentTypes }) }
    }
    if (brief.trim() === '') return { ok: false, reason: EMPTY_BRIEF }

    if (isTeammateType(type.name)) {
      const caller = await this.threads.find({ threadId })
      if (caller?.agent !== undefined) return { ok: false, reason: TEAMMATE_FROM_MAIN_ONLY }
    }

    const model = await this.deps.modelAtSpawn?.({ agentType: type, spawnedBy: threadId })
    const { threadId: agentId, inheritedLocation } = await openChildThread({
      model,
      threads: this.threads,
      log: this.log,
      ids: this.ids,
      spawnedBy: threadId,
      agentType: type,
      brief,
      intent,
    })

    if (inheritedLocation !== undefined) {
      this.sink.note({ threadId: agentId, location: inheritedLocation })
    }

    const child = freshChild({
      agentId,
      spawnedBy: threadId,
      agentType: type.name,
      intent,
      at: this.clock.now(),
      projectDirectory: await childDirectory({ deps: this.deps, threadId }),
    })
    const ref = model === undefined ? undefined : parseRef(model.ref)
    if (ref !== undefined) child.model = { id: ref.providerId, modelId: ref.modelId }
    this.roster.add(child)

    this.steps.take({
      child,
      agentType: type,
      step: ({ runner, signal, pause }) => runner.runTurn({ threadId: agentId, signal, pause }),
    })

    this.deps.telemetry?.agentSpawned({ agentType: type.name })

    return { ok: true, snapshot: snapshotOf(child) }
  }
}
