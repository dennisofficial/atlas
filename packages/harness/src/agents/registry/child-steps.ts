import {
  EAgentStatus,
  type ClockPort,
  type EventDraft,
  type ProviderIdentity,
  type TelemetryPort,
  type ThreadId,
} from '@dltech/atlas-core'

import { PauseSignal } from '../../loop/pause-signal'
import type { TurnOutcome } from '../../loop/turn-outcome'
import type { TurnRunner } from '../../loop/turn-runner.port'
import type { AgentType } from '../types'
import type { ChildRunnerSource } from './child-runner'
import type { HasLiveWork, IntakeChanged } from './deps'
import {
  agentEndedDraft,
  recordContext,
  recordProgress,
  snapshotOf,
  type ChildState,
  type SteerMessage,
} from './child-state'
import { EAgentNotice, type AgentNoticeQueue } from './notices'
import { statusOf } from './reasons'
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
  private readonly clock: ClockPort
  private readonly telemetry: TelemetryPort | undefined
  private readonly intake: IntakeChanged | undefined
  private readonly hasLiveWork: HasLiveWork | undefined
  private readonly inFlight = new Map<ThreadId, Map<ThreadId, Promise<void>>>()
  private readonly settledListeners = new Set<() => void>()

  constructor(args: {
    runners: ChildRunnerSource
    roster: AgentRoster
    notices: AgentNoticeQueue
    clock: ClockPort
    telemetry?: TelemetryPort | undefined
    intake?: IntakeChanged | undefined
    hasLiveWork?: HasLiveWork | undefined
  }) {
    this.runners = args.runners
    this.roster = args.roster
    this.notices = args.notices
    this.clock = args.clock
    this.telemetry = args.telemetry
    this.intake = args.intake
    this.hasLiveWork = args.hasLiveWork
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
    child.steppingSince = this.clock.now()
    this.roster.changed()

    const settled = this.stepped({
      child,
      agentType,
      step,
      signal: child.abort.signal,
      pause: child.pause,
    }).then((status) => this.finish({ child, status }))

    const forThread = this.inFlight.get(child.spawnedBy) ?? new Map<ThreadId, Promise<void>>()
    this.inFlight.set(child.spawnedBy, forThread)
    forThread.set(child.agentId, settled)
    void settled.finally(() => {
      forThread.delete(child.agentId)
      if (forThread.size === 0) this.inFlight.delete(child.spawnedBy)
      if (this.inFlight.size === 0) this.announceSettled()
    })
  }

  settling(): boolean {
    return this.inFlight.size > 0
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

  private async stepped({
    child,
    agentType,
    step,
    signal,
    pause,
  }: {
    child: ChildState
    agentType: AgentType
    step: ChildStep
    signal: AbortSignal
    pause: PauseSignal
  }): Promise<EAgentStatus> {
    try {
      let runner: TurnRunner
      try {
        const built = this.runnerFor({ child, agentType })
        runner = built instanceof Promise ? await built : built
      } catch (error) {
        child.lastFullText = error instanceof Error ? error.message : String(error)
        return signal.aborted ? EAgentStatus.Stopped : EAgentStatus.Failed
      }
      if (signal.aborted) return EAgentStatus.Stopped
      return statusOf(await step({ runner, signal, pause }))
    } catch {
      return signal.aborted ? EAgentStatus.Stopped : EAgentStatus.Failed
    }
  }

  private finish({ child, status }: { child: ChildState; status: EAgentStatus }): void {
    if (this.roster.find(child.agentId) === undefined) return

    child.status = status
    child.endedAt = this.clock.now()
    child.steppingSince = undefined
    this.roster.changed()

    this.telemetry?.agentEnded({
      agentType: child.agentType,
      status,
      turns: child.turns,
      toolCalls: child.toolCalls,
    })

    const kind = this.endingKind(child)
    if (kind !== undefined) {
      this.notices.queue({
        threadId: child.spawnedBy,
        snapshot: snapshotOf(child),
        kind,
        draft: agentEndedDraft(child),
        generation: child.abort.signal,
      })
    }

    this.intake?.changed()
  }

  /**
   * A teammate that still owns live work is pausing between wakes, not ending: the pause is
   * recorded but never queued, so nothing wakes or reaches the parent. One with nothing left
   * that can wake it has gone silent for good, so its ending relays like a sub-agent's.
   */
  private endingKind(child: ChildState): EAgentNotice | undefined {
    if (this.hasLiveWork?.(child.agentId) === true) return undefined
    return EAgentNotice.Ending
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

  private runnerFor({ child, agentType }: { child: ChildState; agentType: AgentType }): TurnRunner | Promise<TurnRunner> {
    return this.runners({
      agentType,
      threadId: child.agentId,
      projectDirectory: child.projectDirectory,
      observe: (drafts) => this.record({ child, drafts }),
      observeContext: ({ tokens, window }) => this.measure({ child, tokens, window }),
      observeModel: (model) => this.noteModel({ child, model }),
      steering: () => {
        const held = child.pending
        let captured: readonly SteerMessage[] | undefined
        return {
          peek: () => {
            captured ??= [...held]
            return captured
          },
          acknowledge: () => {
            const taken = captured ?? []
            if (taken.length > 0) held.splice(0, taken.length)
          },
          release: () => {
            captured = undefined
          },
        }
      },
    })
  }
}
