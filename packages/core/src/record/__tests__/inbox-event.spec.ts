import { describe, expect, it } from 'bun:test'

import { EPrEventKind } from '../../events/body'
import { ENoticeStage } from '../../events/notice-stage'
import { inboxEventOf, inboxEventPayloadOf } from '../inbox-event'

const prEvent = {
  type: 'pr-event' as const,
  repo: 'o/r',
  prNumber: 7,
  kind: EPrEventKind.State,
  url: 'https://github.com/o/r/pull/7',
  state: 'merged',
}

describe('inboxEventOf', () => {
  it('reads a pr-event payload back as the typed event', () => {
    expect(inboxEventOf(inboxEventPayloadOf(prEvent))).toEqual({ ok: true, event: prEvent })
  })

  it('refuses an event type that may not arrive through the inbox', () => {
    const read = inboxEventOf(JSON.stringify({ event: { type: 'user-said', text: 'hi' } }))
    expect(read.ok).toBe(false)
  })

  it('refuses a stamped notice', () => {
    const stamped = { ...prEvent, notice: { id: 'n', stage: ENoticeStage.Arrived } }
    expect(inboxEventOf(JSON.stringify({ event: stamped })).ok).toBe(false)
  })

  it('refuses unreadable payloads', () => {
    expect(inboxEventOf('nope').ok).toBe(false)
    expect(inboxEventOf(JSON.stringify({ text: 'GitHub: PR #7' })).ok).toBe(false)
  })

  it('throws when building a payload for a disallowed event', () => {
    expect(() => inboxEventPayloadOf({ type: 'nudge', text: 'x' } as never)).toThrow()
  })
})
