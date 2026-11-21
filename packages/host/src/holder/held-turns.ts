import type { AgentOutput, LoopTurnRunner, PauseSignal } from '@dltech/atlas-agent'
import {
  ETurnCause,
  openTurnOf,
  type Event,
  type RunId,
  type ThreadId,
  type V2Event,
} from '@dltech/atlas-core'
import { logFieldsOf } from '@dltech/atlas-observability'

import { LiveStepBuffer } from './live-step-buffer'
import { fireLive } from './ports'
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
  eventCache(): { eventsAfter(seq: number): V2Event[] }
}

export class HeldTurns {
  private turnAbort: AbortController | undefined
  private turnAborted = ETurnAborted.Other
  private readonly idleWaiters: (() => void)[] = []
  turnRunning = false
  onTurnEnd: (() => void) | undefined

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
    } catch (error) {
      if (turnId !== undefined) {
        await this.endTurn({ record: args.record, turnId, ending: FAILED_BY_HOST })
      }
      throw error
    } finally {
      this.turnRunning = false
      this.turnAbort = undefined
      const idle = this.idleWaiters.splice(0)
      for (const resolve of idle) resolve()
      this.onTurnEnd?.()
    }
  }

  liveOutput(args: { headSeq: () => number; epoch: number }): AgentOutput {
    const deps = this.deps
    const steps = new LiveStepBuffer({
      timers: deps.timers,
      headSeq: args.headSeq,
      epoch: args.epoch,
      emit: (frame) => deps.bus.live({ sessionId: deps.sessionId, frame }),
    })
    return {
      emit: (event) => {
        if (event.type === 'step-start' || event.type === 'chunk' || event.type === 'step-end') {
          steps.push(event)
          return
        }
        if (event.type === 'tool-output') {
          fireLive({
            bus: deps.bus,
            sessionId: deps.sessionId,
            frame: {
              type: 'tool-output',
              callId: event.output.callId,
              text: event.output.text,
            },
          })
          return
        }
        if (event.type === 'retrying') {
          fireLive({
            bus: deps.bus,
            sessionId: deps.sessionId,
            frame: {
              type: 'retrying',
              attempt: event.attempt,
              maxAttempts: event.maxAttempts,
              reason: String(event.reason),
              delayMs: event.delayMs,
            },
          })
        }
      },
    }
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
    }
  }
}
