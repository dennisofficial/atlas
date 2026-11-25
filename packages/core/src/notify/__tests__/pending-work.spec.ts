import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import type { Event } from '../../events/envelope'
import type { RecordEvent } from '../../record/event'
import { INBOX_EVENT_TYPES } from '../../record/inbox-event'
import { ESubscriptionStatus } from '../../subscriptions/subscription'
import { notifyDecisionOf } from '../decision'
import { ENotifyMoment } from '../moment'
import { operatorTurnOf } from '../operator-turn'
import { EPendingWork, PENDING_WORK_SOURCES, pendingWorkOf } from '../pending-work'
import {
  agentEnded,
  agentRestarted,
  agentSpawned,
  operatorSaid,
  parkedCall,
  serviceStarted,
  shellEnded,
  shellStarted,
  subscriptionChanged,
  subscriptionCreated,
  turnEnded,
  turnStarted,
} from './notify-fixtures'

const pendingOf = (events: readonly RecordEvent[]) =>
  pendingWorkOf({ events: events as readonly Event[] })

const decisionOf = (events: readonly RecordEvent[]) =>
  notifyDecisionOf({
    moment: ENotifyMoment.TurnFinished,
    pending: pendingOf(events),
    operatorTurn: operatorTurnOf({ events }),
  })

describe('PENDING_WORK_SOURCES', () => {
  it('wakes the thread for every type a source counts on', () => {
    for (const source of PENDING_WORK_SOURCES) {
      for (const type of source.wakeTypes) expect(INBOX_EVENT_TYPES.has(type)).toBe(true)
    }
  })

  it('covers each kind exactly once', () => {
    const kinds = PENDING_WORK_SOURCES.map((source) => source.kind)

    expect([...kinds].sort()).toEqual(Object.values(EPendingWork).sort())
  })

  it('keeps one entry per key when an agent restarts twice', () => {
    const pending = pendingOf([
      agentSpawned('thread-child'),
      agentRestarted('thread-child'),
      agentRestarted('thread-child'),
    ])

    expect(pending.map((work) => work.key)).toEqual(['thread-child'])
  })

  it('keys a shell by its boot and id so another boot cannot close it', () => {
    const pending = pendingOf([
      shellStarted({ shellId: 'bash_1', bootId: 'b1' }),
      shellEnded({ shellId: 'bash_1', bootId: 'b2' }),
    ])

    expect(pending.map((work) => work.key)).toEqual(['b1bash_1'])
  })

  it('reads a subscription that paused as no pending work', () => {
    const pending = pendingOf([
      subscriptionCreated('sub-1'),
      subscriptionChanged({ subscriptionId: 'sub-1', status: ESubscriptionStatus.Paused }),
    ])

    expect(pending).toEqual([])
  })
})

const builders: readonly (() => RecordEvent)[] = [
  turnStarted,
  turnEnded,
  operatorSaid,
  () => shellStarted({ shellId: 'bash_1', bootId: 'b1' }),
  () => shellEnded({ shellId: 'bash_1', bootId: 'b1' }),
  () => shellStarted({ shellId: 'bash_2', bootId: 'b1' }),
  () => agentSpawned('thread-child'),
  () => agentEnded('thread-child'),
  () => subscriptionCreated('sub-1'),
  () => subscriptionChanged({ subscriptionId: 'sub-1', status: ESubscriptionStatus.Paused }),
  () => serviceStarted('svc-1'),
  parkedCall,
]

const builderAt = (pick: number): (() => RecordEvent) => {
  const builder = builders[pick % builders.length]
  if (builder === undefined) throw new Error(`no builder at ${pick}`)
  return builder
}

describe('pendingWorkOf stability', () => {
  it('never changes the decision when a settled start and end pair is appended', () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 1000 }), { maxLength: 8 }), (picks) => {
        const events = picks.map((pick) => builderAt(pick)())
        const appended = [
          ...events,
          shellStarted({ shellId: 'bash-extra', bootId: 'b1' }),
          shellEnded({ shellId: 'bash-extra', bootId: 'b1' }),
        ]

        expect(decisionOf(appended)).toEqual(decisionOf(events))
      }),
    )
  })
})
