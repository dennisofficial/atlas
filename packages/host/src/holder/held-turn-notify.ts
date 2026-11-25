import {
  notifyDecisionOf,
  notifyMomentOf,
  operatorTurnOf,
  pendingWorkOf,
  sessionStatusOf,
  toLoopEvent,
  type ESessionStatus,
  type Event,
  type PendingWork,
  type TurnNotify,
  type RecordEvent,
} from '@dltech/atlas-core'
import { logFieldsOf } from '@dltech/atlas-observability'

import type { HeldSessionDeps } from './held-session-deps'
import type { TurnLog } from './held-turns'
import type { TurnEnding } from './turn-boundary'

export type TurnNotifyFacts = {
  pending: readonly PendingWork[]
  operatorTurn: boolean
}

const loopEventsOf = (events: readonly RecordEvent[]): Event[] =>
  events.flatMap((event) => {
    const loop = toLoopEvent({ event })
    return loop === undefined ? [] : [loop]
  })

export const turnNotifyFactsOf = (args: { events: readonly RecordEvent[] }): TurnNotifyFacts => ({
  pending: pendingWorkOf({ events: loopEventsOf(args.events) }),
  operatorTurn: operatorTurnOf({ events: args.events }),
})

export const turnNotifyRowOf = (facts: TurnNotifyFacts): TurnNotify => ({
  pending: [...new Set(facts.pending.map((work) => work.kind))],
  operatorTurn: facts.operatorTurn,
})

const statusOf = (args: { deps: HeldSessionDeps; record: TurnLog }): ESessionStatus => {
  const cache = args.record.eventCache()
  return sessionStatusOf({
    events: cache.eventsAfter(0),
    live: true,
    queuedSince: cache.queuedSince(),
    now: new Date(args.deps.timers.now()).toISOString(),
  }).state
}

const turnEndedAtOf = (args: { record: TurnLog; ending: TurnEnding | null }): string | undefined =>
  args.ending === null ? undefined : args.record.eventCache().eventsAfter(0).at(-1)?.at

export const notifyTurnOf = (args: {
  deps: HeldSessionDeps
  record: TurnLog
  ending: TurnEnding | null
  facts: TurnNotifyFacts
}): void => {
  const notify = args.deps.notify
  if (notify === undefined) return
  const moment = notifyMomentOf({
    ending: args.ending,
    status: statusOf({ deps: args.deps, record: args.record }),
  })
  if (moment === null) return
  const decision = notifyDecisionOf({
    moment,
    pending: args.ending === null ? [] : args.facts.pending,
    operatorTurn: args.facts.operatorTurn,
  })
  const endedAt = turnEndedAtOf({ record: args.record, ending: args.ending })
  void notify({
    sessionId: args.deps.sessionId,
    threadId: args.record.threadId,
    seq: args.record.eventCache().currentHead().seq,
    moment,
    decision,
    ...(endedAt === undefined ? {} : { endedAt }),
  }).catch((error: unknown) => {
    args.deps.log?.warn({
      source: 'holder.turn',
      message: `notifying about the turn on ${args.deps.sessionId} failed`,
      ...logFieldsOf({ error }),
    })
  })
}
