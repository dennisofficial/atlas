import { describe, expect, it } from 'bun:test'

import { PRESENCE_REPORT_MS, PRESENCE_TTL_MS, notifyPresenceOf, presenceIsFresh } from '../presence'
import { EClientSurface } from '../surface'

const AT = '2026-11-23T14:00:00.000Z'

const atOffsetMs = (offset: number): string => new Date(Date.parse(AT) + offset).toISOString()

describe('presence constants', () => {
  it('expires a record after 90 s and asks a client to repeat every 30 s', () => {
    expect(PRESENCE_TTL_MS).toBe(90_000)
    expect(PRESENCE_REPORT_MS).toBe(30_000)
  })
})

describe('presenceIsFresh', () => {
  it('accepts a record 89 s old', () => {
    expect(presenceIsFresh({ at: AT, now: atOffsetMs(89_000) })).toBe(true)
  })

  it('rejects a record 91 s old', () => {
    expect(presenceIsFresh({ at: AT, now: atOffsetMs(91_000) })).toBe(false)
  })

  it('rejects an unparsable timestamp', () => {
    expect(presenceIsFresh({ at: 'not-a-date', now: AT })).toBe(false)
    expect(presenceIsFresh({ at: AT, now: 'not-a-date' })).toBe(false)
  })
})

describe('notifyPresenceOf', () => {
  it('parses one record per hash field', () => {
    const fields = {
      'client-a': JSON.stringify({
        surface: EClientSurface.Web,
        sessionId: 'session-1',
        foreground: true,
        at: AT,
      }),
      'client-b': JSON.stringify({
        surface: EClientSurface.Ios,
        sessionId: null,
        foreground: false,
        at: AT,
      }),
    }

    expect(notifyPresenceOf({ fields })).toEqual([
      { surface: EClientSurface.Web, sessionId: 'session-1', foreground: true, at: AT },
      { surface: EClientSurface.Ios, sessionId: null, foreground: false, at: AT },
    ])
  })

  it('drops an entry that is not JSON', () => {
    expect(notifyPresenceOf({ fields: { 'client-a': 'not-json' } })).toEqual([])
  })

  it('drops an entry with an unknown surface', () => {
    const raw = JSON.stringify({ surface: 'toaster', sessionId: null, foreground: true, at: AT })
    expect(notifyPresenceOf({ fields: { 'client-a': raw } })).toEqual([])
  })

  it('drops an entry with a missing field', () => {
    const raw = JSON.stringify({ surface: EClientSurface.Web, sessionId: null, at: AT })
    expect(notifyPresenceOf({ fields: { 'client-a': raw } })).toEqual([])
  })

  it('returns nothing for an empty hash', () => {
    expect(notifyPresenceOf({ fields: {} })).toEqual([])
  })
})
