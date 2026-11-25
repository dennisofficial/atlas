import {
  ETurnStatus,
  type AgentOutput,
  type LoopTurnRunner,
  type PauseSignal,
} from '@dltech/atlas-agent'
import {
  ETurnCause,
  openTurnOf,
  type Event,
  type RunId,
  type ThreadId,
  type RecordEvent,
} from '@dltech/atlas-core'
import { logFieldsOf } from '@dltech/atlas-observability'

import { notifyTurnOf, turnNotifyFactsOf, turnNotifyRowOf } from './held-turn-notify'
import { turnEndDraftsOf } from './turn-end-drafts'
import { liveOutputOf } from './live-output'
import { logDriveFault } from './held-runner'
import type { HeldSessionDeps } from './held-session-deps'
import type { AppendBody } from './record/append-drafts'
import type { SessionRecord } from './record/record-adapter'
import {
  ETurnAborted,
  FAILED_BY_HOST,
  turnAbortedOf,
  turnEndingOf,
  type TurnEnding,
} from './turn-boundary'

export type TurnLog = {
  threadId: ThreadId
  append(args: {
    threadId: ThreadId
    runId: RunId
    drafts: readonly AppendBody[]
  }): Promise<Event[]>
  eventCache(): {
    eventsAfter(seq: number): RecordEvent[]
    currentHead(): { seq: number }
    queuedSince(): string | null
  }
}

export const startHeldTurn = (args: {
  deps: HeldSessionDeps
  turns: HeldTurns
  record: SessionRecord
  pause: PauseSignal
  runner: LoopTurnRunner
  threadId: ThreadId
  resume: boolean
  queuedAt?: string | undefined
  refreshBranches(): void
  onFault(): void
  onSettled(): void
}): void => {
  void args.turns
    .drive({
      runner: args.runner,
      record: args.record,
      threadId: args.threadId,
      pause: args.pause,
      resume: args.resume,
      ...(args.queuedAt === undefined ? {} : { queuedAt: args.queuedAt }),
    })
    .then(() => {
      args.refreshBranches()
    })
    .catch((error) => {
      logDriveFault({ deps: args.deps, error })
      args.onFault()
    })
    .finally(() => {
      args.onSettled()
    })
}

export class HeldTurns {
  private turnAbort: AbortController | undefined
  private turnAborted = ETurnAborted.Other
  private readonly idleWaiters: (() => void)[] = []
  turnRunning = false
  onTurnEnd: (() => void | Promise<void>) | undefined
  onTurnStart: (() => void) | undefined

  constructor(private readonly deps: HeldSessionDeps) {}

  abort(reason?: unknown): void {
    this.turnAborted = turnAbortedOf(reason)
    this.turnAbort?.abort(reason)
  }

  whenIdle(): Promise<void> {
    if (!this.turnRunning) return Promise.resolve()
    return new Promise<void>((resolve) => this.idleWaiters.push(resolve))
  }

  async drive(args: {
    runner: LoopTurnRunner
    record: TurnLog
    threadId: ThreadId
    pause: PauseSignal
    resume: boolean
    queuedAt?: string | undefined
  }): Promise<void> {
    this.turnAborted = ETurnAborted.Other
    this.turnAbort = new AbortController()
    this.turnRunning = true
    let turnId: string | undefined
    try {
      turnId = await this.startTurn({ record: args.record, resume: args.resume })
      this.reportTurnStarted()
      const outcome = args.resume
        ? await args.runner.resume({
            threadId: args.threadId,
            signal: this.turnAbort.signal,
            pause: args.pause,
            ...(args.queuedAt === undefined ? {} : { queuedAt: args.queuedAt }),
          })
        : await args.runner.runTurn({
            threadId: args.threadId,
            signal: this.turnAbort.signal,
            pause: args.pause,
            ...(args.queuedAt === undefined ? {} : { queuedAt: args.queuedAt }),
          })
      await this.endTurn({
        record: args.record,
        turnId,
        ending: turnEndingOf({ outcome, aborted: this.turnAborted }),
      })
      if (outcome.status === ETurnStatus.Parked) {
        notifyTurnOf({
          deps: this.deps,
          record: args.record,
          ending: null,
          facts: turnNotifyFactsOf({ events: args.record.eventCache().eventsAfter(0) }),
        })
      }
    } catch (error) {
      if (turnId !== undefined) {
        await this.endTurn({ record: args.record, turnId, ending: FAILED_BY_HOST })
      }
      throw error
    } finally {
      await this.settleTurnEnd()
      this.turnRunning = false
      this.turnAbort = undefined
      const idle = this.idleWaiters.splice(0)
      for (const resolve of idle) resolve()
    }
  }

  private reportTurnStarted(): void {
    try {
      this.onTurnStart?.()
    } catch (error) {
      this.deps.log?.warn({
        source: 'holder.turn',
        message: `starting the observations of a turn on ${this.deps.sessionId} failed`,
        ...logFieldsOf({ error }),
      })
    }
  }

  private async settleTurnEnd(): Promise<void> {
    try {
      await this.onTurnEnd?.()
    } catch (error) {
      this.deps.log?.warn({
        source: 'holder.turn',
        message: `the work after the turn on ${this.deps.sessionId} failed`,
        ...logFieldsOf({ error }),
      })
    }
  }

  liveOutput(args: { headSeq: () => number; epoch: number }): AgentOutput {
    return liveOutputOf({
      bus: this.deps.bus,
      liveKey: this.deps.sessionId,
      timers: this.deps.timers,
      headSeq: args.headSeq,
      epoch: args.epoch,
    })
  }

  private async startTurn(args: { record: TurnLog; resume: boolean }): Promise<string> {
    const open = openTurnOf(args.record.eventCache().eventsAfter(0))
    if (open !== null) return open.turnId
    const turnId = `turn-${String(this.deps.ids.nextEventId())}`
    try {
      await args.record.append({
        threadId: args.record.threadId,
        runId: this.deps.ids.nextRunId(),
        drafts: [
          {
            type: 'turn-started',
            turnId,
            cause: args.resume ? ETurnCause.Resume : ETurnCause.Input,
          },
        ],
      })
    } catch (error) {
      this.deps.log?.warn({
        source: 'holder.turn',
        message: `recording the start of turn ${turnId} on ${this.deps.sessionId} failed`,
        ...logFieldsOf({ error }),
      })
    }
    return turnId
  }

  private async endTurn(args: {
    record: TurnLog
    turnId: string
    ending: TurnEnding | null
  }): Promise<void> {
    if (args.ending === null) return
    const events = args.record.eventCache().eventsAfter(0)
    const facts = turnNotifyFactsOf({ events })
    try {
      await args.record.append({
        threadId: args.record.threadId,
        runId: this.deps.ids.nextRunId(),
        drafts: turnEndDraftsOf({
          events,
          turnId: args.turnId,
          ending: args.ending,
          notify: turnNotifyRowOf(facts),
        }),
      })
    } catch (error) {
      this.deps.log?.warn({
        source: 'holder.turn',
        message: `recording the end of turn ${args.turnId} on ${this.deps.sessionId} failed`,
        ...logFieldsOf({ error }),
      })
      return
    }
    notifyTurnOf({ deps: this.deps, record: args.record, ending: args.ending, facts })
    this.reportTurnEnded({ record: args.record })
  }

  private reportTurnEnded(args: { record: TurnLog }): void {
    const turnEnded = this.deps.turnEnded
    if (turnEnded === undefined) return
    void turnEnded({
      sessionId: this.deps.sessionId,
      threadId: args.record.threadId,
    }).catch((error: unknown) => {
      this.deps.log?.warn({
        source: 'holder.turn',
        message: `reporting the end of the turn on ${this.deps.sessionId} failed`,
        ...logFieldsOf({ error }),
      })
    })
  }
}
