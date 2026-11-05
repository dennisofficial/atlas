import { describe, expect, it } from 'bun:test'

import { toCallId } from '../ids'
import type { EventDraft } from '../body'
import { EPrEventKind } from '../body'
import { awaitsPulledInput } from '../pulled-input'
import { arrived, delivered } from './notice-fixture'
import { eventsFrom, replied, said } from './rewind-fixture'

const prEvent: EventDraft = {
  type: 'pr-event',
  repo: 'github.com/owner/repo',
  prNumber: 12,
  kind: EPrEventKind.State,
  url: 'https://github.com/owner/repo/pull/12',
  eventId: 'evt-1',
}

const called: EventDraft = {
  type: 'tool-called',
  callId: toCallId('call-1'),
  name: 'bash',
  input: {},
  ordinal: 0,
}

const stoppedBeforeRunning: EventDraft = {
  type: 'tool-denied',
  callId: toCallId('call-1'),
  name: 'bash',
  reason: 'interrupted',
  interrupted: true,
}

describe('awaitsPulledInput', () => {
  it('is true for a message nobody has answered', () => {
    expect(awaitsPulledInput(eventsFrom([replied('done'), said('and now?')]))).toBe(true)
  })

  it('is false once the assistant has answered', () => {
    expect(awaitsPulledInput(eventsFrom([said('go'), replied('done')]))).toBe(false)
  })

  it('is false when the operator stopped a step before its tool call ran', () => {
    expect(awaitsPulledInput(eventsFrom([said('go'), called, stoppedBeforeRunning]))).toBe(false)
  })

  it('is true for a message sent after such a stop', () => {
    const events = eventsFrom([said('go'), called, stoppedBeforeRunning, said('try again')])

    expect(awaitsPulledInput(events)).toBe(true)
  })

  it('is false when the tail is a delivered notice the thread already took in', () => {
    const events = eventsFrom([said('go'), replied('done'), arrived(prEvent), delivered(prEvent)])

    expect(awaitsPulledInput(events)).toBe(false)
  })

  it('is true when a message precedes a delivered notice and nothing answered either', () => {
    const events = eventsFrom([said('go'), arrived(prEvent), delivered(prEvent)])

    expect(awaitsPulledInput(events)).toBe(true)
  })

  it('is false when the operator stopped at the unanswered message', () => {
    const events = eventsFrom([said('go')])

    expect(awaitsPulledInput(events, events[0]?.id)).toBe(false)
  })

  it('is true for a message newer than the one the operator stopped at', () => {
    const events = eventsFrom([said('go'), said('again')])

    expect(awaitsPulledInput(events, events[0]?.id)).toBe(true)
  })
})
