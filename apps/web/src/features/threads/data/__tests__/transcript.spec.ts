import { describe, expect, it } from 'bun:test'

import { BOOT_STEP_EVENT_TYPE, type WireEvent } from '@dltech/atlas-wire/web'

import { coreEventsOf, ETranscriptKind, transcriptOf } from '../transcript'

const T0 = Date.parse('2026-10-21T10:00:00.000Z')
const isoAt = (offsetMs: number) => new Date(T0 + offsetMs).toISOString()

const wire = (args: {
  seq: number
  type: string
  body: unknown
  offsetMs?: number
}): WireEvent => ({
  id: `evt_${args.seq}`,
  threadId: 'thr_1',
  seq: args.seq,
  runId: 'run_1',
  depth: 0,
  at: isoAt(args.offsetMs ?? args.seq * 1000),
  type: args.type,
  body: JSON.stringify(args.body),
})

const said = (seq: number, text: string) =>
  wire({ seq, type: 'user-said', body: { type: 'user-said', text } })
const answered = (seq: number, parts: unknown[]) =>
  wire({ seq, type: 'assistant-said', body: { type: 'assistant-said', parts } })
const legacyBoot = (seq: number) =>
  wire({ seq, type: BOOT_STEP_EVENT_TYPE, body: { step: 'provision', state: 'running' } })

describe('transcriptOf', () => {
  it('orders user and agent messages by seq and joins text parts', () => {
    const items = transcriptOf([
      answered(3, [
        { type: 'reasoning', text: 'thinking' },
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'there' },
      ]),
      said(1, 'hi'),
    ])
    expect(items.map((item) => [item.kind, item.text])).toEqual([
      [ETranscriptKind.User, 'hi'],
      [ETranscriptKind.Agent, 'Hello there'],
    ])
  })

  it('skips empty agent turns, unknown types and malformed bodies', () => {
    const items = transcriptOf([
      answered(1, [{ type: 'reasoning', text: 'only thoughts' }]),
      wire({ seq: 2, type: 'tool-called', body: { type: 'tool-called' } }),
      { ...said(3, 'x'), body: 'not json' },
      said(4, 'kept'),
    ])
    expect(items.map((item) => item.text)).toEqual(['kept'])
  })
})

describe('legacy boot events', () => {
  it('never reach the transcript', () => {
    const items = transcriptOf([legacyBoot(1), said(2, 'hi'), legacyBoot(3)])
    expect(items.map((item) => item.text)).toEqual(['hi'])
  })

  it('are dropped from the core events', () => {
    const events = [legacyBoot(1), said(2, 'hi'), legacyBoot(3), answered(4, [])]
    expect(coreEventsOf(events).map((event) => event.seq)).toEqual([2, 4])
  })
})
