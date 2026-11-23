import { describe, expect, test } from 'bun:test'

import { EClientSurface, notifyPresenceSchema } from '@dltech/atlas-core'

describe('the terminal surface', () => {
  test('names the terminal on the wire', () => {
    expect(String(EClientSurface.Terminal)).toBe('terminal')
    const parsed = notifyPresenceSchema.parse({
      surface: 'terminal',
      sessionId: 'session-one',
      foreground: true,
      at: '2026-11-23T00:00:00.000Z',
    })
    expect(parsed.surface).toBe(EClientSurface.Terminal)
  })
})
