import { describe, expect, it } from 'bun:test'

import { V2_WAKE_CHANNEL, v2LiveChannel, v2WakeMessageSchema } from '../bus'

describe('v2 bus names', () => {
  it('names the wake channel', () => {
    expect(V2_WAKE_CHANNEL).toBe('v2:wake')
  })

  it('names a per-session live channel', () => {
    expect(v2LiveChannel('session-1')).toBe('v2:live:session-1')
  })

  it('accepts a wake message with a session id', () => {
    expect(v2WakeMessageSchema.parse({ sessionId: 'session-1' })).toEqual({
      sessionId: 'session-1',
    })
  })

  it('rejects empty ids and extra keys', () => {
    expect(v2WakeMessageSchema.safeParse({ sessionId: '' }).success).toBe(false)
    expect(v2WakeMessageSchema.safeParse({ sessionId: 's', extra: 1 }).success).toBe(false)
    expect(v2WakeMessageSchema.safeParse({}).success).toBe(false)
  })
})
