import {
  ETurnCause,
  toCallId,
  toEventId,
  toRunId,
  toThreadId,
  type IdPort,
  type RunId,
  type ThreadId,
  type RecordEvent,
} from '@dltech/atlas-core'

import type { HeldSessionDeps } from '../held-session-deps'
import type { TurnLog } from '../held-turns'
import type { AppendBody } from '../record/append-drafts'

export const THREAD = toThreadId('thread-turns')
export const AT = '2026-11-21T00:00:00.000Z'

export class FakeLog implements TurnLog {
  readonly appended: AppendBody[] = []
  failAppend = false
  headSeq = 1
  queued: string | null = null

  constructor(
    readonly threadId: ThreadId = THREAD,
    private readonly events: readonly RecordEvent[] = [],
  ) {}

  eventCache(): {
    eventsAfter(seq: number): RecordEvent[]
    currentHead(): { seq: number }
    queuedSince(): string | null
  } {
    return {
      eventsAfter: () => [...this.events],
      currentHead: () => ({ seq: this.headSeq }),
      queuedSince: () => this.queued,
    }
  }

  async append(args: {
    threadId: ThreadId
    runId: RunId
    drafts: readonly AppendBody[]
  }): Promise<never[]> {
    if (this.failAppend) throw new Error('append refused')
    this.appended.push(...args.drafts)
    return []
  }
}

const idsOf = (): IdPort => {
  let seq = 0
  const next = (): string => {
    seq += 1
    return String(seq)
  }
  return {
    nextThreadId: () => toThreadId(`thread-${next()}`),
    nextRunId: () => toRunId(`run-${next()}`),
    nextEventId: () => toEventId(`event-${next()}`),
    nextCallId: () => toCallId(`call-${next()}`),
  } as IdPort
}

export const depsOf = (over: Partial<HeldSessionDeps> = {}): HeldSessionDeps =>
  ({
    sessionId: 'session-turns',
    ids: idsOf(),
    timers: { now: () => Date.parse(AT) },
    ...over,
  }) as HeldSessionDeps

export const openTurnIn = (turnId: string): RecordEvent[] =>
  [
    {
      type: 'turn-started',
      turnId,
      cause: ETurnCause.Input,
      id: toEventId(`event-of-${turnId}`),
      seq: 1,
      at: AT,
      threadId: THREAD,
    },
  ] as RecordEvent[]
