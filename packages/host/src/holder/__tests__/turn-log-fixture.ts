import {
  ETurnCause,
  toCallId,
  toEventId,
  toRunId,
  toThreadId,
  type IdPort,
  type RunId,
  type ThreadId,
  type V2Event,
} from '@dltech/atlas-core'

import type { HeldSessionDeps } from '../held-session-deps'
import type { TurnLog } from '../held-turns'
import type { AppendBody } from '../record/append-drafts'

export const THREAD = toThreadId('thread-turns')
const AT = '2026-11-21T00:00:00.000Z'

export class FakeLog implements TurnLog {
  readonly appended: AppendBody[] = []
  failAppend = false

  constructor(
    readonly threadId: ThreadId = THREAD,
    private readonly events: readonly V2Event[] = [],
  ) {}

  eventCache(): { eventsAfter(seq: number): V2Event[] } {
    return { eventsAfter: () => [...this.events] }
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

export const depsOf = (): HeldSessionDeps =>
  ({ sessionId: 'session-turns', ids: idsOf() }) as HeldSessionDeps

export const openTurnIn = (turnId: string): V2Event[] =>
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
  ] as V2Event[]
