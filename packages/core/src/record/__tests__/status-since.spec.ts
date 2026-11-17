import { describe, expect, it } from 'bun:test'

import { toCallId, toEventId, toRunId, toThreadId } from '../../events/ids'
import { EInputConsumed, type Hash, type V2Event } from '../event'
import { ESessionStatus, sessionStatusOf } from '../session-status'

const HASH = 'a'.repeat(64) as Hash
const THREAD = toThreadId('t')
const RUN = toRunId('r')
const CALL = toCallId('c1')
const NOW = '2026-11-03T12:00:00.000Z'
const PREPARED_AT = '2026-11-03T12:00:01.000Z'
const STOPPED_AT = '2026-11-03T12:00:09.000Z'

let seq = 0

const envelope = (
  at: string,
): Pick<V2Event, 'id' | 'seq' | 'threadId' | 'runId' | 'depth' | 'at' | 'epoch' | 'prevHash'> => {
  seq += 1
  return {
    id: toEventId(`t:${seq}`),
    seq,
    threadId: THREAD,
    runId: RUN,
    depth: 0,
    at,
    epoch: 1,
    prevHash: HASH,
  }
}

const userSaid = (): V2Event => ({ ...envelope(NOW), type: 'user-said', text: 'hi' })

const prepared = (): V2Event => ({
  ...envelope(PREPARED_AT),
  type: 'workspace-prepared',
})

const toolDispatched = (): V2Event => ({
  ...envelope(PREPARED_AT),
  type: 'tool-dispatched',
  callId: CALL,
  name: 'bash',
})

const interruptedResult = (): V2Event => ({
  ...envelope(PREPARED_AT),
  type: 'tool-result',
  callId: CALL,
  name: 'bash',
  interrupted: true,
})

const stopConsumed = (): V2Event => ({
  ...envelope(STOPPED_AT),
  type: 'input-consumed',
  inboxId: 1,
  consumed: EInputConsumed.Stop,
})

const statusOf = (events: readonly V2Event[]) =>
  sessionStatusOf({ events, live: true, queuedSince: null, now: NOW })

describe('the time the current status was entered', () => {
  it('moves to the moment the stop was consumed', () => {
    const status = statusOf([userSaid(), prepared(), stopConsumed()])

    expect(status).toEqual({ state: ESessionStatus.Idle, since: STOPPED_AT })
  })

  it('moves to the moment the stop was consumed after an interrupted call', () => {
    const status = statusOf([userSaid(), toolDispatched(), interruptedResult(), stopConsumed()])

    expect(status).toEqual({ state: ESessionStatus.Idle, since: STOPPED_AT })
  })

  it('keeps the prepare time while no stop has arrived', () => {
    const status = statusOf([userSaid(), prepared()])

    expect(status).toEqual({ state: ESessionStatus.Idle, since: PREPARED_AT })
  })
})
