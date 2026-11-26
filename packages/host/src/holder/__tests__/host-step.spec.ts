import { describe, expect, it } from 'bun:test'

import {
  toRunId,
  toThreadId,
  type EventDraft,
  type RecordEvent,
  type RecordEventBody,
} from '@dltech/atlas-core'

import { runInCallScope } from '../../calls/call-scope'
import { hostStepOf } from '../record/host-step'
import { RecordBookkeeping } from '../record/record-bookkeeping'
import type { SessionRecord } from '../record/record-adapter'

const THREAD = toThreadId('33333333-3333-4333-8333-333333333333')
const CALL = 'call-1'

const recordOf = () => {
  const book = new RecordBookkeeping()
  const appended: EventDraft[] = []
  const record = {
    eventCache: () => ({ bookkeeping: () => book }),
    append: async (args: { drafts: readonly EventDraft[] }) => {
      for (const draft of args.drafts) {
        appended.push(draft)
        book.step({
          ...(draft as RecordEventBody),
          id: `e${appended.length}`,
          seq: appended.length,
          threadId: THREAD,
          at: '2026-11-26T10:00:00.000Z',
        } as RecordEvent)
      }
      return []
    },
  } as unknown as Pick<SessionRecord, 'append' | 'eventCache'>
  return { record, appended }
}

const stepOf = (args: {
  record: Pick<SessionRecord, 'append' | 'eventCache'>
  op?: string
  input?: object
}) =>
  hostStepOf({
    record: args.record,
    threadId: THREAD,
    runId: () => toRunId('22222222-2222-4222-8222-222222222222'),
    op: args.op ?? 'sessions.spawn',
    input: args.input ?? { title: 'a' },
  })

describe('hostStepOf', () => {
  it('returns nothing outside a call scope and records nothing', async () => {
    const { record, appended } = recordOf()
    expect(await stepOf({ record })).toBeUndefined()
    expect(appended).toHaveLength(0)
  })

  it('records the step before the effect and returns the same key on a replay', async () => {
    const { record, appended } = recordOf()
    const first = await runInCallScope({ scopeKey: CALL, body: () => stepOf({ record }) })
    expect(first).toEqual({ key: `${CALL}.0`, replayed: false })
    expect(appended).toHaveLength(1)
    const replay = await runInCallScope({ scopeKey: CALL, body: () => stepOf({ record }) })
    expect(replay).toEqual({ key: `${CALL}.0`, replayed: true })
    expect(appended).toHaveLength(1)
  })

  it('gives a diverged replay a fresh slot, never the recorded one', async () => {
    const { record } = recordOf()
    await runInCallScope({ scopeKey: CALL, body: () => stepOf({ record }) })
    const diverged = await runInCallScope({
      scopeKey: CALL,
      body: () => stepOf({ record, input: { title: 'b' } }),
    })
    expect(diverged).toEqual({ key: `${CALL}.1`, replayed: false })
  })

  it('makes two identical effects in one body two steps, and a replay reuses both', async () => {
    const { record } = recordOf()
    const twice = () =>
      runInCallScope({
        scopeKey: CALL,
        body: async () => [await stepOf({ record }), await stepOf({ record })],
      })
    expect((await twice()).map((step) => step?.key)).toEqual([`${CALL}.0`, `${CALL}.1`])
    expect(await twice()).toEqual([
      { key: `${CALL}.0`, replayed: true },
      { key: `${CALL}.1`, replayed: true },
    ])
  })
})
