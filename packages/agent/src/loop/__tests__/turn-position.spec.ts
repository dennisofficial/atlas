import { describe, expect, it } from 'bun:test'

import {
  EServiceStatus,
  stampDrafts,
  toCallId,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type EventDraft,
} from '@dltech/atlas-core'

import { messageArrivedSince } from '../turn-position'

const eventsFrom = (drafts: readonly EventDraft[]): Event[] =>
  stampDrafts({
    drafts,
    envelopes: drafts.map((_, index) => ({
      id: toEventId(`evt-${index + 1}`),
      seq: index + 1,
      threadId: toThreadId('thread-1'),
      runId: toRunId('run-1'),
      depth: 0,
      at: '2026-11-08T16:00:00.000Z',
    })),
  })

const asked: EventDraft = { type: 'user-said', text: 'start a service' }
const answered: EventDraft = { type: 'assistant-said', parts: [{ type: 'text', text: 'done' }] }
const ended: EventDraft = {
  type: 'service-ended',
  serviceId: 'svc-1',
  command: 'serve',
  status: EServiceStatus.Killed,
  tail: '',
}
const settled: EventDraft = {
  type: 'tool-result',
  callId: toCallId('call-1'),
  name: 'service_stop',
  output: { serviceId: 'svc-1' },
}

const arrived = (drafts: readonly EventDraft[], seenThrough: number): boolean =>
  messageArrivedSince({ events: eventsFrom(drafts), seenThrough })

describe('messageArrivedSince', () => {
  it('is false without a seen mark', () => {
    expect(messageArrivedSince({ events: eventsFrom([asked]), seenThrough: undefined })).toBe(false)
  })

  it('is false when nothing followed the seen mark', () => {
    expect(arrived([asked], 1)).toBe(false)
  })

  it('is true for a message nobody answered', () => {
    expect(arrived([asked], 0)).toBe(true)
  })

  it('is false for a message the model already answered', () => {
    expect(arrived([asked, answered], 0)).toBe(false)
  })

  it('is true for a message that landed after the model answered', () => {
    expect(arrived([asked, answered, { type: 'user-said', text: 'again' }], 2)).toBe(true)
  })

  it('is false for an ending that landed before the model answered it', () => {
    expect(arrived([settled, ended, answered], 1)).toBe(false)
  })

  it('is true for an ending that landed after the model answered', () => {
    expect(arrived([answered, ended], 1)).toBe(true)
  })

  it('is true for a tool result that still needs a reply', () => {
    expect(arrived([settled], 0)).toBe(true)
  })
})
