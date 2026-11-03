import { describe, expect, it } from 'bun:test'

import { WAKE_CHANNEL, sessionLiveChannel, wakeMessageSchema } from '../bus'

describe('bus names', () => {
  it('names the wake channel', () => {
    expect(WAKE_CHANNEL).toBe('atlas:session-wake')
  })

  it('names a per-session live channel', () => {
    expect(sessionLiveChannel('session-1')).toBe('atlas:session-live:session-1')
  })

  it('accepts a wake message with a session id', () => {
    expect(wakeMessageSchema.parse({ sessionId: 'session-1' })).toEqual({
      sessionId: 'session-1',
    })
  })

  it('rejects empty ids and extra keys', () => {
    expect(wakeMessageSchema.safeParse({ sessionId: '' }).success).toBe(false)
    expect(wakeMessageSchema.safeParse({ sessionId: 's', extra: 1 }).success).toBe(false)
    expect(wakeMessageSchema.safeParse({}).success).toBe(false)
  })
})
