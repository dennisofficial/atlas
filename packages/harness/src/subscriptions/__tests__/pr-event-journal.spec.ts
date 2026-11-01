import { describe, expect, it } from 'bun:test'
import { ENoticeStage, EPrEventKind, type EventDraft } from '@dltech/atlas-core'

import { stampArrival } from '../pr-event-notice'
import { isAckablePrEvent, PrEventIntake } from '../pr-event-journal'
import { MemoryLog } from './memory-log'
import { FakeClock } from './fake-schedule'
import { ReadyQueue } from '../ready-queue'
import { toThreadId } from '@dltech/atlas-core'

const prEvent = (eventId?: string): EventDraft => ({
  type: 'pr-event',
  repo: 'github.com/compai/app',
  prNumber: 42,
  kind: EPrEventKind.Verdict,
  url: 'https://github.com/compai/app/pull/42',
  ...(eventId === undefined ? {} : { eventId }),
})

describe('pr-event notice stamping', () => {
  it('stamps an eventId-carrying pr-event as arrived under a stable notice id', () => {
    const stamped = stampArrival(prEvent('evt-1'))
    if (!isAckablePrEvent(stamped)) throw new Error('expected an ackable pr-event')
    expect(stamped.notice).toEqual({ id: 'pr-event:evt-1', stage: ENoticeStage.Arrived })
  })

  it('leaves a pr-event with no eventId unstamped', () => {
    const stamped = stampArrival(prEvent())
    expect(isAckablePrEvent(stamped)).toBe(false)
  })

  it('recognizes an ackable pr-event only when it carries an eventId', () => {
    expect(isAckablePrEvent(prEvent('evt-1'))).toBe(true)
    expect(isAckablePrEvent(prEvent())).toBe(false)
    expect(isAckablePrEvent({ type: 'user-said', text: 'hi' })).toBe(false)
  })
})

describe('PrEventIntake', () => {
  const intakeOf = () => {
    const log = new MemoryLog()
    const clock = new FakeClock()
    const queue = new ReadyQueue()
    const acked: string[][] = []
    const warnings: string[] = []
    let counter = 0
    const intake = new PrEventIntake({
      log,
      ids: {
        nextThreadId: () => toThreadId('t'),
        nextRunId: () => `run-${counter++}` as never,
        nextEventId: () => 'e' as never,
        nextCallId: () => 'c' as never,
      },
      queue,
      ack: ({ eventIds }) => acked.push(eventIds),
      warn: (message) => warnings.push(message),
      changed: () => undefined,
    })
    return { intake, log, queue, acked, warnings }
  }

  it('journals the arrival and acks the API once the append returns', async () => {
    const { intake, log, acked } = intakeOf()
    intake.journalArrival({
      threadId: toThreadId('main'),
      draft: stampArrival(prEvent('evt-1')) as never,
    })
    await new Promise((resolve) => setImmediate(resolve))

    expect(log.ofType('pr-event')).toHaveLength(1)
    expect(acked).toEqual([['evt-1']])
  })

  it('requeues a journaled arrival that was never delivered', async () => {
    const { intake, log, queue } = intakeOf()
    const draft = stampArrival(prEvent('evt-1'))
    await log.append({ threadId: toThreadId('main'), drafts: [draft] })

    intake.requeueOwed({ threadId: toThreadId('main'), events: log.stored })

    const pending = queue.pending({ threadId: toThreadId('main') })
    expect(pending).toHaveLength(1)
    expect(pending[0]?.draft.type).toBe('pr-event')
  })
})
