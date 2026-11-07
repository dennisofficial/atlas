import { describe, expect, it } from 'bun:test'

import { chainEvents } from '../chain-events'
import { v2EventSchema, type V2Body } from '../event'
import { isRecordOnly } from '../loop-events'
import { ESessionStatus, sessionStatusOf } from '../session-status'
import { activeStartFailure } from '../start-failure'
import { NOW, runId, threadId } from './support'

const log = (bodies: V2Body[]) => chainEvents({ threadId, runId, epoch: 1, at: NOW, bodies })

const failed = (inboxHead: number, permanent = false): V2Body => ({
  type: 'session-start-failed',
  reason: 'sandbox is not configured: no token',
  inboxHead,
  permanent,
})

const status = (args: { bodies: V2Body[]; messageAfterFailure?: boolean; pending?: boolean }) =>
  sessionStatusOf({
    events: log(args.bodies),
    live: false,
    unconsumedInbox: args.pending ?? false,
    messageAfterFailure: args.messageAfterFailure ?? false,
    now: NOW,
  })

describe('session-start-failed', () => {
  it('round-trips through the v2 event schema as a record-only event', () => {
    const [event] = log([failed(3, true)])
    const parsed = v2EventSchema.parse(event)
    expect(parsed.type).toBe('session-start-failed')
    expect(isRecordOnly(parsed)).toBe(true)
  })

  it('rejects a failure without a permanence flag', () => {
    const [event] = log([failed(1)])
    const { permanent: _permanent, ...partial } = event as unknown as Record<string, unknown>
    expect(v2EventSchema.safeParse(partial).success).toBe(false)
  })
})

describe('activeStartFailure', () => {
  it('is the last failure with nothing after it', () => {
    expect(activeStartFailure(log([failed(2, true)]))).toEqual({
      inboxHead: 2,
      reason: 'sandbox is not configured: no token',
      permanent: true,
      at: NOW,
    })
  })

  it('is absent without a failure', () => {
    expect(activeStartFailure(log([{ type: 'workspace-prepared' }]))).toBeUndefined()
  })

  it.each<[string, V2Body]>([
    ['a user message', { type: 'user-said', text: 'hi' }],
    ['an assistant reply', { type: 'assistant-said', parts: [{ type: 'text', text: 'ok' }] }],
    ['a prepared workspace', { type: 'workspace-prepared' }],
    ['a prepare failure', { type: 'workspace-prepare-failed', reason: 'x', inboxHead: 1 }],
  ])('ends at %s', (_name, ender) => {
    expect(activeStartFailure(log([failed(1), ender]))).toBeUndefined()
  })

  it('survives record-only events that do not start a turn', () => {
    const events = log([failed(1), { type: 'input-consumed', inboxId: 1 }])
    expect(activeStartFailure(events)?.inboxHead).toBe(1)
  })

  it('tracks the newest failure after an earlier one was superseded', () => {
    const events = log([failed(1), { type: 'user-said', text: 'hi' }, failed(4)])
    expect(activeStartFailure(events)?.inboxHead).toBe(4)
  })
})

describe('sessionStatusOf with a start failure', () => {
  it('reports failed with the reason, even while the failed message is unconsumed', () => {
    expect(status({ bodies: [failed(1)], pending: true })).toEqual({
      state: ESessionStatus.StartFailed,
      reason: 'sandbox is not configured: no token',
      since: NOW,
    })
  })

  it('reports failed on a session that already ran', () => {
    const result = status({
      bodies: [{ type: 'workspace-prepared' }, { type: 'user-said', text: 'a' }, failed(1)],
    })
    expect(result.state).toBe(ESessionStatus.StartFailed)
  })

  it('reports sent once a newer message arrived', () => {
    expect(status({ bodies: [failed(1)], messageAfterFailure: true, pending: true }).state).toBe(
      ESessionStatus.Sent,
    )
  })

  it('stops reporting failed once a turn ran after it', () => {
    const result = status({
      bodies: [
        failed(1),
        { type: 'user-said', text: 'b' },
        { type: 'assistant-said', parts: [{ type: 'text', text: 'ok' }] },
      ],
    })
    expect(result.state).toBe(ESessionStatus.Idle)
  })
})
