import { describe, expect, it } from 'bun:test'

import type { Event } from '../../events/envelope'
import type { V2Event } from '../../record/event'
import { ESubscriptionStatus } from '../../subscriptions/subscription'
import { ENotifyVerdict, notifyDecisionOf } from '../decision'
import { ENotifyMoment } from '../moment'
import { operatorTurnOf } from '../operator-turn'
import { EPendingWork, pendingWorkOf } from '../pending-work'
import {
  agentEnded,
  agentRestarted,
  agentSpawned,
  HOLD_SHELL_MS,
  HOLD_SUBSCRIPTION_MS,
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

const pendingOf = (events: readonly V2Event[]) =>
  pendingWorkOf({ events: events as readonly Event[] })

const decided = (args: { moment: ENotifyMoment; events: readonly V2Event[] }) =>
  notifyDecisionOf({
    moment: args.moment,
    pending: pendingOf(args.events),
    operatorTurn: operatorTurnOf({ events: args.events }),
  })

const finished = (events: readonly V2Event[]) =>
  decided({ moment: ENotifyMoment.TurnFinished, events })
const failed = (events: readonly V2Event[]) => decided({ moment: ENotifyMoment.TurnFailed, events })
const waiting = (events: readonly V2Event[]) =>
  decided({ moment: ENotifyMoment.WaitingForYou, events })

describe('notifyDecisionOf at a turn end', () => {
  it('sends a finished turn with nothing open', () => {
    const decision = finished([turnStarted(), turnEnded()])

    expect(decision.verdict).toBe(ENotifyVerdict.Send)
    expect(decision.holdMs).toBe(0)
    expect(decision.pending).toEqual([])
  })

  it('holds a finished turn with a shell that started and did not end', () => {
    const decision = finished([shellStarted({ shellId: 'bash_1', bootId: 'b1' }), turnEnded()])

    expect(decision.verdict).toBe(ENotifyVerdict.Hold)
    expect(decision.holdMs).toBe(HOLD_SHELL_MS)
    expect(decision.pending).toEqual([EPendingWork.Shell])
  })

  it('sends a finished turn whose shell started and ended', () => {
    const decision = finished([
      shellStarted({ shellId: 'bash_1', bootId: 'b1' }),
      shellEnded({ shellId: 'bash_1', bootId: 'b1' }),
      turnEnded(),
    ])

    expect(decision.verdict).toBe(ENotifyVerdict.Send)
    expect(decision.holdMs).toBe(0)
  })

  it('holds a finished turn whose shell ended under another boot id only', () => {
    const decision = finished([
      shellStarted({ shellId: 'bash_1', bootId: 'b1' }),
      shellEnded({ shellId: 'bash_1', bootId: 'b2' }),
      turnEnded(),
    ])

    expect(decision.verdict).toBe(ENotifyVerdict.Hold)
    expect(decision.holdMs).toBe(HOLD_SHELL_MS)
  })

  it('holds a finished turn with an agent that spawned and did not end', () => {
    const decision = finished([agentSpawned('thread-child'), turnEnded()])

    expect(decision.verdict).toBe(ENotifyVerdict.Hold)
    expect(decision.holdMs).toBe(HOLD_SHELL_MS)
    expect(decision.pending).toEqual([EPendingWork.Agent])
  })

  it('holds a finished turn with an agent restarted after it ended', () => {
    const decision = finished([
      agentSpawned('thread-child'),
      agentEnded('thread-child'),
      agentRestarted('thread-child'),
      turnEnded(),
    ])

    expect(decision.verdict).toBe(ENotifyVerdict.Hold)
    expect(decision.holdMs).toBe(HOLD_SHELL_MS)
    expect(decision.pending).toEqual([EPendingWork.Agent])
  })

  it('holds a finished turn with an active subscription', () => {
    const decision = finished([subscriptionCreated('sub-1'), turnEnded()])

    expect(decision.verdict).toBe(ENotifyVerdict.Hold)
    expect(decision.holdMs).toBe(HOLD_SUBSCRIPTION_MS)
    expect(decision.pending).toEqual([EPendingWork.Subscription])
  })

  it('sends a finished turn whose subscription paused', () => {
    const decision = finished([
      subscriptionCreated('sub-1'),
      subscriptionChanged({ subscriptionId: 'sub-1', status: ESubscriptionStatus.Paused }),
      turnEnded(),
    ])

    expect(decision.verdict).toBe(ENotifyVerdict.Send)
    expect(decision.holdMs).toBe(0)
  })

  it('holds a finished turn whose subscription paused and then went active', () => {
    const decision = finished([
      subscriptionCreated('sub-1'),
      subscriptionChanged({ subscriptionId: 'sub-1', status: ESubscriptionStatus.Paused }),
      subscriptionChanged({ subscriptionId: 'sub-1', status: ESubscriptionStatus.Active }),
      turnEnded(),
    ])

    expect(decision.verdict).toBe(ENotifyVerdict.Hold)
    expect(decision.holdMs).toBe(HOLD_SUBSCRIPTION_MS)
  })

  it('holds for the longest hold when a subscription and a shell are open', () => {
    const decision = finished([
      subscriptionCreated('sub-1'),
      shellStarted({ shellId: 'bash_1', bootId: 'b1' }),
      turnEnded(),
    ])

    expect(decision.verdict).toBe(ENotifyVerdict.Hold)
    expect(decision.holdMs).toBe(HOLD_SHELL_MS)
    expect(decision.pending).toEqual([EPendingWork.Shell, EPendingWork.Subscription])
  })

  it('sends a finished turn with a service started', () => {
    const decision = finished([serviceStarted('svc-1'), turnEnded()])

    expect(decision.verdict).toBe(ENotifyVerdict.Send)
    expect(decision.holdMs).toBe(0)
  })

  it('sends a failed turn even with a shell open', () => {
    const decision = failed([shellStarted({ shellId: 'bash_1', bootId: 'b1' }), turnEnded()])

    expect(decision.verdict).toBe(ENotifyVerdict.Send)
    expect(decision.holdMs).toBe(0)
    expect(decision.pending).toEqual([EPendingWork.Shell])
  })

  it('sends a parked call as waiting for the operator', () => {
    const decision = waiting([parkedCall()])

    expect(decision.verdict).toBe(ENotifyVerdict.Send)
    expect(decision.holdMs).toBe(0)
    expect(decision.pending).toEqual([])
  })

  it('carries the operator turn into the decision', () => {
    const decision = finished([turnStarted(), operatorSaid(), turnEnded()])

    expect(decision.operatorTurn).toBe(true)
  })
})
