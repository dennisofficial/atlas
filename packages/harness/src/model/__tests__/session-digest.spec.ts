import {
  EContextSlot,
  toRunId,
  toThreadId,
  type Event,
  type EventDraft,
} from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { sessionDigest } from '../session-digest'

const RUN = toRunId('run_opening')
const THREAD = toThreadId('brn_test')

const eventOf = (seq: number, body: EventDraft, runId: string = RUN): Event =>
  ({
    ...body,
    id: `evt_${seq}`,
    seq,
    threadId: THREAD,
    runId,
    depth: 0,
    at: '2026-09-28T00:00:00.000Z',
  }) as Event

const said = (seq: number, text: string, runId?: string): Event =>
  eventOf(seq, { type: 'user-said', text }, runId)

const reply = (seq: number, text: string, runId?: string): Event =>
  eventOf(seq, { type: 'assistant-said', parts: [{ type: 'text', text }] }, runId)

const file = (seq: number, key: string, content: string, runId?: string): Event =>
  eventOf(seq, { type: 'context-loaded', slot: EContextSlot.File, key, content }, runId)

describe('sessionDigest', () => {
  it('is empty when there is nothing logged yet', () => {
    expect(sessionDigest([])).toBe('')
  })

  it('is the labeled transcript of a short session', () => {
    const digest = sessionDigest([said(1, 'the refresh token never rotates'), reply(2, 'on it')])

    expect(digest).toBe('Operator: the refresh token never rotates\nAtlas: on it')
  })

  it('rejoins the opening message with the head of a file it attached', () => {
    const digest = sessionDigest([
      file(1, '/tmp/handoff.md', '# Handoff: rewind kills sub-agents\n\nWhen a turn is rewound...'),
      said(2, 'check out this handoff, and lets plan it'),
      reply(3, 'reading it now'),
    ])

    expect(digest).toContain('Operator: check out this handoff, and lets plan it')
    expect(digest).toContain('[Attached file: /tmp/handoff.md]')
    expect(digest).toContain('Handoff: rewind kills sub-agents')
    expect(digest).toContain('Atlas: reading it now')
  })

  it('does not excerpt a file attached to a later turn into the opening line', () => {
    const digest = sessionDigest([
      said(1, 'the refresh token never rotates'),
      reply(2, 'on it'),
      said(3, 'now look at this file', 'run_second'),
      file(4, '/tmp/late.md', 'a late attachment', 'run_second'),
    ])

    expect(digest.startsWith('Operator: the refresh token never rotates')).toBe(true)
    expect(digest).not.toContain('[Attached file: /tmp/late.md]')
  })

  it('elides the middle of a long session rather than sending it whole', () => {
    const digest = sessionDigest([
      said(1, 'start'),
      reply(2, 'x'.repeat(5000)),
      said(3, 'the most recent thing'),
    ])

    expect(digest.length).toBeLessThan(300 + 1500 + 20)
    expect(digest).toContain('…')
    expect(digest).toContain('the most recent thing')
  })
})
