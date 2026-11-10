import { describe, expect, test } from 'bun:test'
import { SESSION_MARKER, sessionUrlOf } from '../session-url'

describe('sessionUrlOf', () => {
  test('puts the secret on the desktop session route', () => {
    expect(sessionUrlOf({ origin: 'http://127.0.0.1:4100', secret: 'abc' })).toBe(
      'http://127.0.0.1:4100/desktop/session?secret=abc',
    )
  })
  test('marks the line the shell waits for', () => {
    expect(SESSION_MARKER).toBe('ATLAS_URL=')
  })
})
