import { describe, expect, it } from 'bun:test'
import { ENotifyMoment } from '@dltech/atlas-core'

import {
  NOTIFY_CLEAR_TASK_ID,
  NOTIFY_SEND_TASK_ID,
  NOTIFY_TEST_TASK_ID,
  notifyClearIdempotencyKey,
  notifyClearPayloadSchema,
  notifySendIdempotencyKey,
  notifySendPayloadSchema,
  notifyTestIdempotencyKey,
  notifyTestPayloadSchema,
} from '../notify'

describe('the notify send task', () => {
  it('registers under the dispatch id', () => {
    expect(NOTIFY_SEND_TASK_ID).toBe('notify-send')
  })

  it('accepts a moment and a seq', () => {
    expect(
      notifySendPayloadSchema.parse({
        sessionId: 'session-1',
        threadId: 'thread-1',
        seq: 7,
        moment: ENotifyMoment.TurnFinished,
      }),
    ).toEqual({
      sessionId: 'session-1',
      threadId: 'thread-1',
      seq: 7,
      moment: ENotifyMoment.TurnFinished,
    })
  })

  it('rejects an unknown moment and a fractional seq', () => {
    expect(
      notifySendPayloadSchema.safeParse({
        sessionId: 'session-1',
        threadId: 'thread-1',
        seq: 1,
        moment: 'poked',
      }).success,
    ).toBe(false)
    expect(
      notifySendPayloadSchema.safeParse({
        sessionId: 'session-1',
        threadId: 'thread-1',
        seq: 1.5,
        moment: ENotifyMoment.TurnFinished,
      }).success,
    ).toBe(false)
  })

  it('keys one dispatch per session and seq', () => {
    const payload = {
      sessionId: 'session-1',
      threadId: 'thread-1',
      seq: 7,
      moment: ENotifyMoment.TurnFinished,
    }

    expect(notifySendIdempotencyKey(payload)).toBe('notify:session-1:7')
  })
})

describe('the notify test task', () => {
  it('registers under the dispatch id', () => {
    expect(NOTIFY_TEST_TASK_ID).toBe('notify-test')
  })

  it('takes one user', () => {
    expect(notifyTestPayloadSchema.parse({ userId: 'usr-1' })).toEqual({ userId: 'usr-1' })
    expect(notifyTestPayloadSchema.safeParse({ userId: '' }).success).toBe(false)
  })

  it('collapses presses inside one minute and separates the next', () => {
    const payload = { userId: 'usr-1' }

    expect(notifyTestIdempotencyKey({ payload, now: '2026-11-23T14:02:00.000Z' })).toBe(
      notifyTestIdempotencyKey({ payload, now: '2026-11-23T14:02:59.999Z' }),
    )
    expect(notifyTestIdempotencyKey({ payload, now: '2026-11-23T14:03:00.000Z' })).not.toBe(
      notifyTestIdempotencyKey({ payload, now: '2026-11-23T14:02:59.999Z' }),
    )
  })
})

describe('the notify clear task', () => {
  it('registers under the dispatch id', () => {
    expect(NOTIFY_CLEAR_TASK_ID).toBe('notify-clear')
  })

  it('takes one user and one session', () => {
    expect(notifyClearPayloadSchema.parse({ userId: 'usr-1', sessionId: 'session-1' })).toEqual({
      userId: 'usr-1',
      sessionId: 'session-1',
    })
    expect(notifyClearPayloadSchema.safeParse({ userId: 'usr-1', sessionId: '' }).success).toBe(
      false,
    )
    expect(notifyClearPayloadSchema.safeParse({ userId: 'usr-1' }).success).toBe(false)
  })

  it('keys one clear per session and moment', () => {
    expect(notifyClearIdempotencyKey({ sessionId: 'session-1', momentSeq: 7 })).toBe(
      'notify-clear:session-1:7',
    )
  })
})
