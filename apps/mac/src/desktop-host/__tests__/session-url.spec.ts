import { describe, expect, test } from 'bun:test'
import { CERT_MARKER, HTTP_ORIGIN_MARKER, SESSION_MARKER, sessionUrlOf } from '../session-url'

describe('sessionUrlOf', () => {
  test('puts the secret on the desktop session route', () => {
    expect(sessionUrlOf({ origin: 'http://127.0.0.1:4100', secret: 'abc' })).toBe(
      'http://127.0.0.1:4100/desktop/session?secret=abc',
    )
  })
  test('marks the lines the shell waits for', () => {
    expect(SESSION_MARKER).toBe('ATLAS_URL=')
    expect(HTTP_ORIGIN_MARKER).toBe('ATLAS_HTTP_ORIGIN=')
    expect(CERT_MARKER).toBe('ATLAS_CERT=')
  })
})
