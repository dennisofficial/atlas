import {
  ETurnStatus,
  type AgentOutput,
  type LoopTurnRunner,
  type PauseSignal,
} from '@dltech/atlas-agent'
import type { ThreadId } from '@dltech/atlas-core'

import type { InboxIntake } from './inbox-intake'
import { statusFrame } from './ports'
import type { HeldSessionDeps } from './held-session-deps'

const TURN_EXITED = new Set<ETurnStatus>([ETurnStatus.Failed, ETurnStatus.Interrupted])

export class HeldTurns {
  private turnAbort: AbortController | undefined
  private inboxTimer: unknown
  turnRunning = false

  constructor(private readonly deps: HeldSessionDeps) {}

  abort(reason?: unknown): void {
    this.turnAbort?.abort(reason)
  }

  async drive(args: {
    runner: LoopTurnRunner
    threadId: ThreadId
    intake: InboxIntake
    pause: PauseSignal
    resume: boolean
    onActivity(): void
  }): Promise<void> {
    this.turnAbort = new AbortController()
    this.turnRunning = true
    this.scheduleInboxPoll({ intake: args.intake })
    this.deps.bus.live({
      sessionId: this.deps.sessionId,
      frame: statusFrame({ state: 'thinking' }),
    })
    try {
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
      if (TURN_EXITED.has(outcome.status as ETurnStatus)) args.onActivity()
    } finally {
      if (this.inboxTimer !== undefined) this.deps.timers.clearTimeout(this.inboxTimer)
      this.turnRunning = false
      this.turnAbort = undefined
      this.deps.bus.live({ sessionId: this.deps.sessionId, frame: statusFrame({ state: 'idle' }) })
      args.onActivity()
    }
  }

  private scheduleInboxPoll(args: { intake: InboxIntake }): void {
    this.inboxTimer = this.deps.timers.setTimeout(() => {
      void args.intake.pollStops().finally(() => {
        if (this.turnRunning) this.scheduleInboxPoll(args)
      })
    }, this.deps.inboxPollMs)
  }

  liveOutput(): AgentOutput {
    const deps = this.deps
    return {
      emit: (event) => {
        if (event.type === 'tool-output') {
          deps.bus.live({
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
          deps.bus.live({
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
}
