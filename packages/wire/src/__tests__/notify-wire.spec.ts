import { describe, expect, it } from 'bun:test'

import { EClientSurface } from '@dltech/atlas-core'

import { reportNotifyPresenceInputSchema } from '../notify-wire'

describe('reportNotifyPresenceInputSchema', () => {
  it('accepts a foreground report of one session', () => {
    const parsed = reportNotifyPresenceInputSchema.parse({
      clientId: 'client-a',
      surface: 'desktop',
      sessionId: 'session-1',
      foreground: true,
    })
    expect(parsed).toEqual({
      clientId: 'client-a',
      surface: EClientSurface.Desktop,
      sessionId: 'session-1',
      foreground: true,
    })
  })

  it('accepts a null session for a client that shows the list', () => {
    expect(
      reportNotifyPresenceInputSchema.safeParse({
        clientId: 'client-a',
        surface: 'web',
        sessionId: null,
        foreground: true,
      }).success,
    ).toBe(true)
  })

  it('rejects a surface that is not a client surface', () => {
    const parsed = reportNotifyPresenceInputSchema.safeParse({
      clientId: 'client-a',
      surface: 'tui',
      sessionId: null,
      foreground: true,
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects an empty client id and a client id longer than 64 characters', () => {
    const base = { surface: 'ios', sessionId: null, foreground: false }
    expect(reportNotifyPresenceInputSchema.safeParse({ ...base, clientId: '' }).success).toBe(false)
    expect(
      reportNotifyPresenceInputSchema.safeParse({ ...base, clientId: 'a'.repeat(65) }).success,
    ).toBe(false)
  })

  it('rejects an unknown key', () => {
    expect(
      reportNotifyPresenceInputSchema.safeParse({
        clientId: 'client-a',
        surface: 'web',
        sessionId: null,
        foreground: true,
        threadId: 'thread-1',
      }).success,
    ).toBe(false)
  })
})
