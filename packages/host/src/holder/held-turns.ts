import {
  ETurnStatus,
  type AgentOutput,
  type LoopTurnRunner,
  type PauseSignal,
} from '@dltech/atlas-agent'
import {
  ETurnCause,
  notifyMomentOf,
  openTurnOf,
  sessionStatusOf,
  type ESessionStatus,
  type Event,
  type RunId,
  type ThreadId,
  type V2Event,
} from '@dltech/atlas-core'
import { logFieldsOf } from '@dltech/atlas-observability'

import { liveOutputOf } from './live-output'
import type { HeldSessionDeps } from './held-session-deps'
import type { AppendBody } from './record/append-drafts'
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
    eventsAfter(seq: number): V2Event[]
    currentHead(): { seq: number }
    queuedSince(): string | null
  }
}

export class HeldTurns {
  private turnAbort: AbortController | undefined
  private turnAborted = ETurnAborted.Other
  private readonly idleWaiters: (() => void)[] = []
  turnRunning = false
  onTurnEnd: (() => void | Promise<void>) | undefined

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
  }): Promise<void> {
    this.turnAborted = ETurnAborted.Other
    this.turnAbort = new AbortController()
    this.turnRunning = true
    let turnId: string | undefined
    try {
      turnId = await this.startTurn({ record: args.record, resume: args.resume })
      const outcome = args.resume
        ? await args.runner.resume({
            threadId: args.threadId,
            signal: this.turnAbort.signal,
            pause: args.pause,
          })
        : await args.runner.runTurn({
            threadId: args.threadId,
            signal: this.turnAbort.signal,
            pause: args.pause,
          })
      await this.endTurn({
        record: args.record,
        turnId,
        ending: turnEndingOf({ outcome, aborted: this.turnAborted }),
      })
      if (outcome.status === ETurnStatus.Parked) {
        this.notifyTurn({ record: args.record, ending: null })
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
    try {
      await args.record.append({
        threadId: args.record.threadId,
        runId: this.deps.ids.nextRunId(),
        drafts: [
          {
            type: 'turn-ended',
            turnId: args.turnId,
            outcome: args.ending.outcome,
            by: args.ending.by,
          },
        ],
      })
    } catch (error) {
      this.deps.log?.warn({
        source: 'holder.turn',
        message: `recording the end of turn ${args.turnId} on ${this.deps.sessionId} failed`,
        ...logFieldsOf({ error }),
      })
      return
    }
    this.notifyTurn({ record: args.record, ending: args.ending })
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

  private notifyTurn(args: { record: TurnLog; ending: TurnEnding | null }): void {
    const notify = this.deps.notify
    if (notify === undefined) return
    const moment = notifyMomentOf({ ending: args.ending, status: this.statusOf(args.record) })
    if (moment === null) return
    void notify({
      sessionId: this.deps.sessionId,
      threadId: args.record.threadId,
      seq: args.record.eventCache().currentHead().seq,
      moment,
    }).catch((error: unknown) => {
      this.deps.log?.warn({
        source: 'holder.turn',
        message: `notifying about the turn on ${this.deps.sessionId} failed`,
        ...logFieldsOf({ error }),
      })
    })
  }

  private statusOf(record: TurnLog): ESessionStatus {
    const cache = record.eventCache()
    return sessionStatusOf({
      events: cache.eventsAfter(0),
      live: true,
      queuedSince: cache.queuedSince(),
      now: new Date(this.deps.timers.now()).toISOString(),
    }).state
  }
}
