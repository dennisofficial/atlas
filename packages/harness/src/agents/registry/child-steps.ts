import {
  EAgentStatus,
  EKilledBy,
  type ClockPort,
  type EventDraft,
  type ProviderIdentity,
  type TelemetryPort,
  type ThreadId,
} from '@dltech/atlas-core'

import { PauseSignal } from '../../loop/pause-signal'
import type { TurnOutcome } from '../../loop/turn-outcome'
import type { TurnRunner } from '../../loop/turn-runner.port'
import { ESpeech, speechOf, type AgentType } from '../types'
import type { ChildRunnerSource } from './child-runner'
import { ChildAdmissions } from './child-admissions'
import type { InheritOrphanedNotices, IntakeChanged } from './deps'
import type { EndShells, LeftServicesProbe, RunningShellProbe } from './deps'
import {
  isHeld,
  isWaiting,
  parkWaiting,
  recordContext,
  recordProgress,
  type ChildState,
} from './child-state'
import { AgentJournal } from './agent-journal'
import { recordEnding, shellsEndedFor } from './child-endings'
import { steeringOf } from './child-steering'
import { EAgentNotice, type AgentNoticeQueue } from './notices'
import { steppedStatus } from './stepped-status'
import type { AgentRoster } from './roster'

export type ChildStep = (args: {
  runner: TurnRunner
  signal: AbortSignal
  pause: PauseSignal
}) => Promise<TurnOutcome>

export class ChildSteps {
  private readonly runners: ChildRunnerSource
  private readonly roster: AgentRoster
  private readonly notices: AgentNoticeQueue
  private readonly journal: AgentJournal
  private readonly clock: ClockPort
  private readonly telemetry: TelemetryPort | undefined
  private readonly intake: IntakeChanged | undefined
  private readonly runningShell: RunningShellProbe
  private readonly endShells: EndShells
  private readonly leftServices: LeftServicesProbe
  private readonly inheritOrphanedNotices: InheritOrphanedNotices | undefined
  private readonly onEnded: ((threadId: ThreadId) => void) | undefined
  private readonly inFlight = new Map<ThreadId, Map<ThreadId, Promise<void>>>()
  private readonly settledListeners = new Set<() => void>()
  private readonly admissions = new ChildAdmissions({
    onSettled: () => {
      if (!this.settling()) this.announceSettled()
    },
  })

  constructor(args: {
    runners: ChildRunnerSource
    roster: AgentRoster
    notices: AgentNoticeQueue
    journal: AgentJournal
    clock: ClockPort
    telemetry?: TelemetryPort | undefined
    intake?: IntakeChanged | undefined
    runningShell?: RunningShellProbe | undefined
    endShells?: EndShells | undefined
    leftServices?: LeftServicesProbe | undefined
    inheritOrphanedNotices?: InheritOrphanedNotices | undefined
    onEnded?: ((threadId: ThreadId) => void) | undefined
  }) {
    this.runners = args.runners
    this.roster = args.roster
    this.notices = args.notices
    this.journal = args.journal
    this.clock = args.clock
    this.telemetry = args.telemetry
    this.intake = args.intake
    this.runningShell = args.runningShell ?? (() => undefined)
    this.endShells = args.endShells ?? (() => Promise.resolve())
    this.leftServices = args.leftServices ?? (() => [])
    this.inheritOrphanedNotices = args.inheritOrphanedNotices
    this.onEnded = args.onEnded
  }

  take({
    child,
    agentType,
    step,
  }: {
    child: ChildState
    agentType: AgentType
    step: ChildStep
  }): void {
    child.abort = new AbortController()
    child.pause = new PauseSignal()
    child.status = EAgentStatus.Running
    child.killedBy = undefined
    child.endedAt = undefined
    child.deliveredAt = undefined
    child.waitingOn = undefined
    child.waitingFor = undefined
    child.steppingSince = this.clock.now()
    this.roster.changed()

    const settled = steppedStatus({
      child,
      step,
      signal: child.abort.signal,
      pause: child.pause,
      runnerFor: () => this.runnerFor({ child, agentType }),
    }).then((status) => this.finish({ child, status, speech: speechOf(agentType) }))

    this.track({ child, settled })
  }

  endHeld({ child, killedBy }: { child: ChildState; killedBy: EKilledBy }): void {
    if (!(isHeld(child) || isWaiting(child)) || child.killedBy !== undefined) return
    child.killedBy = killedBy
    this.track({
      child,
      settled: shellsEndedFor({ endShells: this.endShells, child, killedBy }).then(() =>
        this.finish({ child, status: EAgentStatus.Stopped, speech: ESpeech.OnEnd }),
      ),
    })
  }

  pauseHeld({ child }: { child: ChildState }): void {
    if (!isHeld(child)) return
    this.track({
      child,
      settled: this.finish({ child, status: EAgentStatus.Paused, speech: ESpeech.OnEnd }),
    })
  }

  private track({ child, settled }: { child: ChildState; settled: Promise<void> }): void {
    const forThread = this.inFlight.get(child.spawnedBy) ?? new Map<ThreadId, Promise<void>>()
    this.inFlight.set(child.spawnedBy, forThread)
    forThread.set(child.agentId, settled)
    void settled.finally(() => {
      forThread.delete(child.agentId)
      if (forThread.size === 0) this.inFlight.delete(child.spawnedBy)
      if (!this.settling()) this.announceSettled()
    })
  }

  admit<T>(args: { threadId: ThreadId; start: () => Promise<T> }): Promise<T> {
    return this.admissions.admit(args)
  }

  admitting(args: { threadIds: readonly ThreadId[] }): boolean {
    return this.admissions.settling(args)
  }

  whenAdmitted(args: { threadIds: readonly ThreadId[] }): Promise<void> {
    return this.admissions.whenSettled(args)
  }

  settling(): boolean {
    return this.inFlight.size > 0 || this.admissions.settling()
  }

  onSettled(listener: () => void): () => void {
    this.settledListeners.add(listener)
    return () => this.settledListeners.delete(listener)
  }

  private announceSettled(): void {
    for (const listener of [...this.settledListeners]) listener()
  }

  async whenSettled(args?: {
    threadId?: ThreadId | undefined
    excluding?: readonly ThreadId[] | undefined
  }): Promise<void> {
    if (args?.threadId === undefined) {
      await Promise.all([...this.inFlight.values()].flatMap((byChild) => [...byChild.values()]))
      return
    }

    const excluded = new Set(args.excluding ?? [])
    const forThread = this.inFlight.get(args.threadId) ?? new Map<ThreadId, Promise<void>>()
    await Promise.all(
      [...forThread.entries()].flatMap(([childId, settled]) =>
        excluded.has(childId) ? [] : [settled],
      ),
    )
  }

  private async finish({
    child,
    status,
    speech,
  }: {
    child: ChildState
    status: EAgentStatus
    speech: ESpeech
  }): Promise<void> {
    if (this.roster.find(child.agentId) === undefined) return

    if (status === EAgentStatus.WaitingForModel && child.waitingFor !== undefined) {
      parkWaiting({ child, episode: child.waitingFor })
      this.roster.changed()
      this.intake?.changed()
      return
    }

    const shell =
      speech === ESpeech.OnEnd && status === EAgentStatus.Finished
        ? this.runningShell(child.agentId)
        : undefined
    if (shell !== undefined) {
      child.steppingSince = undefined
      child.waitingOn = shell
      this.roster.changed()
      this.intake?.changed()
      return
    }

    child.status = status
    child.endedAt = this.clock.now()
    child.steppingSince = undefined
    child.waitingOn = undefined
    child.waitingFor = undefined
    this.roster.changed()

    this.inheritOrphanedNotices?.({ from: child.agentId, to: child.spawnedBy })

    this.telemetry?.agentEnded({
      agentType: child.agentType,
      status,
      turns: child.turns,
      toolCalls: child.toolCalls,
    })

    const bookkeeping = speech === ESpeech.ByReport && status === EAgentStatus.Finished
    await recordEnding({
      journal: this.journal,
      notices: this.notices,
      roster: this.roster,
      child,
      kind: bookkeeping ? undefined : EAgentNotice.Ending,
      leftServices: this.leftServices(child.agentId),
    })
    if (!bookkeeping) this.onEnded?.(child.agentId)

    this.intake?.changed()
  }

  private record({ child, drafts }: { child: ChildState; drafts: readonly EventDraft[] }): void {
    recordProgress({ child, drafts })
    this.roster.changed()
  }

  private measure({
    child,
    tokens,
    window,
  }: {
    child: ChildState
    tokens: number
    window: number
  }): void {
    recordContext({ child, tokens, window })
    this.roster.changed()
  }

  private noteModel({ child, model }: { child: ChildState; model: ProviderIdentity }): void {
    if (child.model?.id === model.id && child.model.modelId === model.modelId) return

    child.model = model
    this.roster.changed()
  }

  private runnerFor({
    child,
    agentType,
  }: {
    child: ChildState
    agentType: AgentType
  }): TurnRunner | Promise<TurnRunner> {
    return this.runners({
      agentType,
      threadId: child.agentId,
      projectDirectory: child.projectDirectory,
      observe: (drafts) => this.record({ child, drafts }),
      observeContext: ({ tokens, window }) => this.measure({ child, tokens, window }),
      observeModel: (model) => this.noteModel({ child, model }),
      steering: () => steeringOf(child),
    })
  }
}
