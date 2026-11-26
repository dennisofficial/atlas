import { describe, expect, it } from 'bun:test'

import { ECrashedCall } from '@dltech/atlas-agent'
import {
  EToolEffect,
  toCallId,
  toRunId,
  toThreadId,
  type PendingCall,
  type RecordEvent,
  type RecordEventBody,
} from '@dltech/atlas-core'

import { crashSettleOf } from '../crash-settle'
import type { SessionRuntime } from '../ports'
import { RecordBookkeeping } from '../record/record-bookkeeping'
import type { SessionRecord } from '../record/record-adapter'

const CALL_ID = '11111111-1111-4111-8111-111111111111'

const call = (name: string): PendingCall => ({
  callId: toCallId(CALL_ID),
  name,
  input: {},
  ordinal: 0,
  runId: toRunId('22222222-2222-4222-8222-222222222222'),
  threadId: toThreadId('33333333-3333-4333-8333-333333333333'),
})

const bookOf = (bodies: readonly RecordEventBody[]): RecordBookkeeping => {
  const book = new RecordBookkeeping()
  for (const [index, body] of bodies.entries()) {
    book.step({
      ...body,
      id: `e${index + 1}`,
      seq: index + 1,
      threadId: call('x').threadId,
      at: '2026-11-26T10:00:00.000Z',
    } as RecordEvent)
  }
  return book
}

const settleOf = (args: { name: string; bodies: readonly RecordEventBody[] }) => {
  const book = bookOf(args.bodies)
  const runtime = {
    daemonTools: new Set(['bash']),
    effectOf: (name: string) => (name === 'read_file' ? EToolEffect.Read : EToolEffect.Write),
  } as unknown as SessionRuntime
  const record = { eventCache: () => ({ bookkeeping: () => book }) } as unknown as SessionRecord
  return crashSettleOf({ runtime, record, call: call(args.name) })
}

const dispatched = (bootId?: string): RecordEventBody => ({
  type: 'tool-dispatched',
  callId: toCallId(CALL_ID),
  name: 'service',
  ...(bootId === undefined ? {} : { bootId }),
})

const step = (): RecordEventBody => ({
  type: 'fact-recorded',
  key: `${CALL_ID}.0`,
  kind: 'effect-started',
  value: { op: 'services.start', digest: 'digest', bootId: 'boot-a' },
})

describe('crashSettleOf', () => {
  it('holds a built-in daemon tool so the body runs again', () => {
    expect(settleOf({ name: 'bash', bodies: [dispatched('boot-a')] })).toBe(ECrashedCall.Hold)
  })

  it('holds a read tool', () => {
    expect(settleOf({ name: 'read_file', bodies: [dispatched('boot-a')] })).toBe(ECrashedCall.Hold)
  })

  it('holds a plugin call that recorded a step, so every step is asked about', () => {
    expect(settleOf({ name: 'service', bodies: [dispatched('boot-a'), step()] })).toBe(
      ECrashedCall.Hold,
    )
  })

  it('interrupts a plugin call that recorded no step, whatever boot its dispatch names', () => {
    expect(settleOf({ name: 'service', bodies: [dispatched('boot-a')] })).toBe(
      ECrashedCall.Interrupt,
    )
  })

  it('interrupts a host-side-effect call whose effect opens no pod step', () => {
    expect(settleOf({ name: 'agent_spawn', bodies: [dispatched('boot-a')] })).toBe(
      ECrashedCall.Interrupt,
    )
  })

  it('interrupts a plugin call whose dispatch recorded no boot', () => {
    expect(settleOf({ name: 'service', bodies: [dispatched()] })).toBe(ECrashedCall.Interrupt)
  })

  it('interrupts a plugin call with no dispatch marker at all', () => {
    expect(settleOf({ name: 'service', bodies: [] })).toBe(ECrashedCall.Interrupt)
  })
})
