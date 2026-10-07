import {
  EKilledBy,
  NoopExecutionLocationSink,
  type EExecutionLocation,
  type EventLogPort,
  type ExecutionLocationSinkPort,
  type IdPort,
  type SaidImage,
  type ThreadId,
} from '@dltech/atlas-core'

import type { InputBatch } from '../../intake/input-batch'
import type { AgentType } from '../types'
import { ChildSteps } from './child-steps'
import type { SupervisorDeps } from './deps'
import { snapshotOf, type ChildState } from './child-state'
import { NoticeDelivery, type NoticeDrain } from './delivery'
import { AgentNoticeQueue } from './notices'
import { NoticeWake } from './notice-wake'
import { followAgentModels } from './model-follow'
import { forgetRemovedChildren } from './remove-children'
import { AgentRegistryPort, type AgentOutcome, type RelocateChildrenArgs } from './port'
import { ChildRecovery } from './recovery'
import {
  markThreadChildrenRelocated,
  pauseThreadChildren,
  relocateThreadChildren,
  resumeChild,
  stopThreadChildren,
  type Relocation,
} from './relocate-children'
import { unknownAgent } from './reasons'
import { reportToParent, say, sayToPeer } from './say'
import { AgentRoster } from './roster'
import { ChildSpawner } from './spawn-child'
import type { AgentSnapshot, RecoveredAgents } from './snapshot'
import { stopAllChildren, stopChild } from './stop-all'

export class AgentSupervisor extends AgentRegistryPort {
  private readonly log: EventLogPort
  private readonly ids: IdPort
  private readonly agentTypes: readonly AgentType[]
  private readonly roster = new AgentRoster()
  private readonly notices = new AgentNoticeQueue()
  private readonly delivery: NoticeDelivery
  private readonly steps: ChildSteps
  private readonly recovery: ChildRecovery
  private readonly sink: ExecutionLocationSinkPort
  private readonly deps: SupervisorDeps
  private readonly relocation: Relocation
  private readonly noticeWake: NoticeWake
  private readonly spawner: ChildSpawner

  constructor(args: SupervisorDeps) {
    super()
    this.deps = args
    this.log = args.log
    this.ids = args.ids
    this.agentTypes = args.agentTypes
    this.sink = args.sink ?? new NoopExecutionLocationSink()
    this.steps = new ChildSteps({
      runners: args.runners,
      roster: this.roster,
      notices: this.notices,
      clock: args.clock,
      ...(args.telemetry === undefined ? {} : { telemetry: args.telemetry }),
      ...(args.hasLiveWork === undefined ? {} : { hasLiveWork: args.hasLiveWork }),
      ...(args.inheritOrphanedNotices === undefined
        ? {}
        : { inheritOrphanedNotices: args.inheritOrphanedNotices }),
      ...(args.onChildEnded === undefined ? {} : { onEnded: args.onChildEnded }),
    })
    this.spawner = new ChildSpawner({
      threads: args.threads,
      log: args.log,
      ids: args.ids,
      clock: args.clock,
      roster: this.roster,
      steps: this.steps,
      agentTypes: args.agentTypes,
      sink: this.sink,
      deps: args,
    })
    this.noticeWake = new NoticeWake({
      roster: this.roster,
      steps: this.steps,
      agentTypes: args.agentTypes,
      deps: args,
    })
    this.delivery = new NoticeDelivery({ notices: this.notices, roster: this.roster, clock: args.clock })
    this.recovery = new ChildRecovery({
      log: args.log,
      threads: args.threads,
      ids: args.ids,
      clock: args.clock,
      roster: this.roster,
      notices: this.notices,
      launchDirectory: args.launchDirectory,
    })
    this.relocation = {
      deps: args,
      sink: this.sink,
      roster: this.roster,
      steps: this.steps,
      recovery: this.recovery,
      delivery: this.delivery,
    }

    followAgentModels({ threads: args.threads, roster: this.roster })
  }

  types(): readonly AgentType[] {
    return this.agentTypes
  }

  spawn(args: {
    threadId: ThreadId
    agentType: string
    brief: string
    intent: string
  }): Promise<AgentOutcome> {
    return this.spawner.spawn(args)
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
      notices: this.notices,
      steps: this.steps,
      deps: this.deps,
    })
  }

  resume(args: { agentId: ThreadId; threadId: ThreadId }): Promise<AgentOutcome> {
    return resumeChild({ ...args, ...this.relocation })
  }

  wake({ agentId }: { agentId: ThreadId }): Promise<AgentOutcome> {
    return this.noticeWake.wake({ agentId })
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
      notices: this.notices,
      steps: this.steps,
      deps: this.deps,
    })
  }

  reportToParent(args: { threadId: ThreadId; text: string }): Promise<AgentOutcome> {
    return reportToParent({
      ...args,
      log: this.log,
      ids: this.ids,
      agentTypes: this.agentTypes,
      roster: this.roster,
      notices: this.notices,
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

  async pauseChildren(args: { threadId: ThreadId }): Promise<readonly ThreadId[]> {
    const paused = await pauseThreadChildren({ ...args, ...this.relocation })
    return paused.map((child) => child.agentId)
  }

  markChildrenRelocated(args: {
    threadId: ThreadId
    location: EExecutionLocation
  }): Promise<void> {
    return markThreadChildrenRelocated({ ...args, ...this.relocation })
  }

  async stop({
    agentId,
    threadId,
    by,
  }: {
    agentId: ThreadId
    threadId: ThreadId
    by: EKilledBy
  }): Promise<AgentOutcome> {
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

  someChild(threadId: ThreadId, where: (child: ChildState) => boolean): boolean {
    return this.roster.states().some((child) => child.spawnedBy === threadId && where(child))
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

  override async hydrateTransferred({ threadId }: { threadId: ThreadId }): Promise<void> {
    const owners = await this.recovery.hydrateTransferred({ threadId })
    for (const owner of owners) {
      this.notices.forgetAgents({ threadId: owner.threadId, agentIds: owner.agentIds })
    }
  }

  whenChildrenSettled({ threadId }: { threadId: ThreadId }): Promise<void> {
    return this.steps.whenSettled({ threadId })
  }

  override settling(): boolean {
    return this.steps.settling()
  }

  override onSettled(listener: () => void): () => void {
    return this.steps.onSettled(listener)
  }

  recordLostAgents({ threadId }: { threadId: ThreadId }): Promise<RecoveredAgents> {
    return this.recovery.recordLost({ threadId })
  }

  listEverywhere(): readonly AgentSnapshot[] {
    return this.roster.listEverywhere()
  }

  drainNotifications({ threadId }: { threadId: ThreadId }): NoticeDrain {
    return this.delivery.drain({ threadId })
  }

  override prepareNotifications({ threadId }: { threadId: ThreadId }): InputBatch {
    return this.delivery.prepareNotifications({ threadId })
  }

  pendingNotices({ threadId }: { threadId: ThreadId }): readonly AgentSnapshot[] {
    return this.notices.pending({ threadId })
  }

  threadsAwaitingNotice(): readonly ThreadId[] {
    return this.notices.threadsAwaiting()
  }

  override threadsWithPendingInput(): readonly ThreadId[] {
    return this.notices.threadsQueued()
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
