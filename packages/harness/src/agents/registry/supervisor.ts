import {
  EAgentRestart,
  EKilledBy,
  EMessageOrigin,
  NoopExecutionLocationSink,
  type ClockPort,
  type EExecutionLocation,
  type EventDraft,
  type EventLogPort,
  type ExecutionLocationSinkPort,
  type IdPort,
  type SaidImage,
  type ThreadId,
} from '@dltech/atlas-core'

import type { ThreadStorePort } from '../../store'
import { isTeammateType, type AgentType } from '../types'
import { ChildSteps } from './child-steps'
import { agentTypeNamed, type SupervisorDeps } from './deps'
import { freshChild, isStepping, snapshotOf, type ChildState } from './child-state'
import { NoticeDelivery } from './delivery'
import { AgentNoticeQueue } from './notices'
import { openChildThread } from './open-child'
import { forgetRemovedChildren } from './remove-children'
import { AgentRegistryPort, type AgentOutcome, type RelocateChildrenArgs } from './port'
import { recordRestart } from './record-restart'
import { ChildRecovery } from './recovery'
import {
  childDirectory,
  markThreadChildrenRelocated,
  relocateThreadChildren,
  resumeChild,
  stopThreadChildren,
  type Relocation,
} from './relocate-children'
import {
  alreadyStepping,
  deliberatelyStopped,
  EMPTY_BRIEF,
  retiredAgentType,
  TEAMMATE_FROM_MAIN_ONLY,
  unknownAgent,
  unknownAgentType,
} from './reasons'
import { say, sayToPeer } from './say'
import { AgentRoster } from './roster'
import type { AgentSnapshot, RecoveredAgents } from './snapshot'
import { stopAllChildren, stopChild } from './stop-all'

export class AgentSupervisor extends AgentRegistryPort {
  private readonly log: EventLogPort
  private readonly threads: ThreadStorePort
  private readonly ids: IdPort
  private readonly clock: ClockPort
  private readonly agentTypes: readonly AgentType[]
  private readonly roster = new AgentRoster()
  private readonly notices = new AgentNoticeQueue()
  private readonly delivery: NoticeDelivery
  private readonly steps: ChildSteps
  private readonly recovery: ChildRecovery
  private readonly launchDirectory: string
  private readonly sink: ExecutionLocationSinkPort
  private readonly deps: SupervisorDeps
  private readonly relocation: Relocation

  constructor(args: SupervisorDeps) {
    super()
    this.deps = args
    this.log = args.log
    this.threads = args.threads
    this.ids = args.ids
    this.clock = args.clock
    this.agentTypes = args.agentTypes
    this.launchDirectory = args.launchDirectory
    this.sink = args.sink ?? new NoopExecutionLocationSink()
    this.steps = new ChildSteps({
      runners: args.runners,
      roster: this.roster,
      notices: this.notices,
      clock: args.clock,
    })
    this.delivery = new NoticeDelivery({ notices: this.notices, roster: this.roster, clock: args.clock })
    this.recovery = new ChildRecovery({
      log: args.log,
      threads: args.threads,
      ids: args.ids,
      clock: args.clock,
      roster: this.roster,
    })
    this.relocation = {
      deps: args,
      sink: this.sink,
      roster: this.roster,
      steps: this.steps,
      recovery: this.recovery,
      delivery: this.delivery,
    }
  }

  types(): readonly AgentType[] {
    return this.agentTypes
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

    const { threadId: agentId, inheritedLocation } = await openChildThread({
      threads: this.threads,
      log: this.log,
      ids: this.ids,
      spawnedBy: threadId,
      agentType: type,
      brief,
      intent,
    })

    if (inheritedLocation !== undefined) this.sink.note({ threadId: agentId, location: inheritedLocation })

    const child = freshChild({
      agentId,
      spawnedBy: threadId,
      agentType: type.name,
      intent,
      at: this.clock.now(),
      projectDirectory: await childDirectory({ deps: this.deps, threadId }),
    })
    this.roster.add(child)

    this.steps.take({
      child,
      agentType: type,
      step: ({ runner, signal }) => runner.runTurn({ threadId: agentId, signal }),
    })

    return { ok: true, snapshot: snapshotOf(child) }
  }

  say(args: {
    agentId: ThreadId
    threadId: ThreadId
    text: string
    images?: readonly SaidImage[] | undefined
  }): Promise<AgentOutcome> {
    return say({
      ...args,
      log: this.log,
      ids: this.ids,
      agentTypes: this.agentTypes,
      roster: this.roster,
      steps: this.steps,
      deps: this.deps,
    })
  }

  resume(args: { agentId: ThreadId; threadId: ThreadId }): Promise<AgentOutcome> {
    return resumeChild({ ...args, ...this.relocation })
  }

  async wake({ agentId }: { agentId: ThreadId }): Promise<AgentOutcome> {
    const child = this.roster.find(agentId)
    if (child === undefined) {
      return { ok: false, reason: unknownAgent({ agentId, known: this.roster.listEverywhere() }) }
    }
    if (isStepping(child)) return { ok: false, reason: alreadyStepping(agentId) }
    if (child.killedBy !== undefined) {
      return { ok: false, reason: deliberatelyStopped({ agentId }) }
    }

    const agentType = agentTypeNamed({ agentTypes: this.agentTypes, name: child.agentType })
    if (agentType === undefined) {
      return { ok: false, reason: retiredAgentType(child.agentType) }
    }

    child.projectDirectory ??= await childDirectory({ deps: this.deps, threadId: child.spawnedBy })
    await recordRestart({ log: this.log, ids: this.ids, child, via: EAgentRestart.Wake })
    this.steps.take({
      child,
      agentType,
      step: ({ runner, signal }) => runner.runTurn({ threadId: agentId, signal }),
    })
    return { ok: true, snapshot: snapshotOf(child) }
  }

  sayToPeer(args: {
    agentId: ThreadId
    threadId: ThreadId
    text: string
    images?: readonly SaidImage[] | undefined
  }): Promise<AgentOutcome> {
    return sayToPeer({
      ...args,
      log: this.log,
      ids: this.ids,
      agentTypes: this.agentTypes,
      roster: this.roster,
      steps: this.steps,
      deps: this.deps,
    })
  }

  relocateChildren(args: RelocateChildrenArgs): Promise<readonly ThreadId[]> {
    return relocateThreadChildren({ ...args, ...this.relocation })
  }

  async stopChildren(args: { threadId: ThreadId; by: EKilledBy }): Promise<readonly ThreadId[]> {
    const stopped = await stopThreadChildren({ ...args, ...this.relocation })
    return stopped.map((child) => child.agentId)
  }

  markChildrenRelocated(args: {
    threadId: ThreadId
    location: EExecutionLocation
  }): Promise<void> {
    return markThreadChildrenRelocated({ ...args, ...this.relocation })
  }

  stop({
    agentId,
    threadId,
    by,
  }: {
    agentId: ThreadId
    threadId: ThreadId
    by: EKilledBy
  }): AgentOutcome {
    const child = this.childFor({ agentId, threadId })
    if (child === undefined) {
      return { ok: false, reason: unknownAgent({ agentId, known: this.list({ threadId }) }) }
    }

    stopChild({ child, by })
    return { ok: true, snapshot: snapshotOf(child) }
  }

  list({ threadId }: { threadId: ThreadId }): readonly AgentSnapshot[] {
    void this.hydrate({ threadId })
    return this.roster.list(threadId)
  }

  async removeChildren({
    threadId,
    agentIds,
  }: {
    threadId: ThreadId
    agentIds: readonly ThreadId[]
  }): Promise<void> {
    await this.hydrate({ threadId })
    forgetRemovedChildren({ roster: this.roster, notices: this.notices, threadId, agentIds })
  }

  hydrate({ threadId }: { threadId: ThreadId }): Promise<void> {
    return this.recovery.hydrate({ threadId })
  }

  whenChildrenSettled({ threadId }: { threadId: ThreadId }): Promise<void> {
    return this.steps.whenSettled({ threadId })
  }

  recordLostAgents({ threadId }: { threadId: ThreadId }): Promise<RecoveredAgents> {
    return this.recovery.recordLost({ threadId })
  }

  listEverywhere(): readonly AgentSnapshot[] {
    return this.roster.listEverywhere()
  }

  drainNotifications({ threadId }: { threadId: ThreadId }): readonly EventDraft[] {
    return this.delivery.drain({ threadId })
  }

  pendingNotices({ threadId }: { threadId: ThreadId }): readonly AgentSnapshot[] {
    return this.notices.pending({ threadId })
  }

  threadsAwaitingNotice(): readonly ThreadId[] {
    return this.notices.threadsAwaiting()
  }

  onNotice(listener: () => void): () => void {
    return this.notices.onNotice(listener)
  }

  onChange(listener: () => void): () => void {
    return this.roster.onChange(listener)
  }

  forgetNotices({ threadId }: { threadId: ThreadId }): void {
    this.notices.forget({ threadId })
  }

  closeAll(): Promise<void> {
    return stopAllChildren({ roster: this.roster, steps: this.steps })
  }

  private childFor({
    agentId,
    threadId,
  }: {
    agentId: ThreadId
    threadId: ThreadId
  }): ChildState | undefined {
    const child = this.roster.find(agentId)
    return child === undefined || child.spawnedBy !== threadId ? undefined : child
  }
}
