import { describe, expect, it } from 'bun:test'

import type { IAuthSession } from '../auth-api'
import { EDeviceKind, deviceKindOf, deviceNameOf, signedInDevicesOf, toDevice } from '../device'

const NOW = Date.parse('2026-10-20T12:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

const sessionOf = (rest: Partial<IAuthSession> & { token: string }): IAuthSession => ({
  id: rest.token,
  createdAt: ago(60_000 * 5),
  expiresAt: 'x',
  ...rest,
})

describe('deviceNameOf', () => {
  it('names a browser on a platform', () => {
    expect(
      deviceNameOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Chrome/120 Safari/537'),
    ).toBe('Chrome on macOS')
    expect(deviceNameOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Version/18 Safari/604')).toBe(
      'Safari on iOS',
    )
  })

  it('falls back to the unknown device and to a clipped agent', () => {
    expect(deviceNameOf(null)).toBe('Unknown device')
    expect(deviceNameOf(undefined)).toBe('Unknown device')
    expect(deviceNameOf('SomeAgent/1.0')).toBe('SomeAgent/1.0')
  })

  it('keeps an Atlas CLI name whole', () => {
    expect(deviceNameOf('atlas-cli/2.0.0')).toBe('atlas-cli/2.0.0')
  })
})

describe('deviceKindOf', () => {
  it('calls the CLI and Atlas agents a command line', () => {
    expect(deviceKindOf('curl/8')).toBe(EDeviceKind.Cli)
    expect(deviceKindOf('atlas/1.0')).toBe(EDeviceKind.Cli)
    expect(deviceKindOf('Mozilla/5.0 Chrome/120')).toBe(EDeviceKind.Browser)
    expect(deviceKindOf(null)).toBe(EDeviceKind.Browser)
  })
})

describe('toDevice', () => {
  it('marks the current session and reads its last activity', () => {
    const session = sessionOf({ token: 't', userAgent: 'curl/8', ipAddress: '1.2.3.4' })
    expect(toDevice({ session, currentToken: 't', now: NOW })).toEqual({
      id: 't',
      current: true,
      kind: EDeviceKind.Cli,
      name: 'curl',
      meta: '1.2.3.4, Last active 5m ago',
    })
    expect(toDevice({ session, currentToken: 'other', now: NOW }).current).toBe(false)
    expect(toDevice({ session, currentToken: 't', now: NOW }).meta).not.toContain('\u00b7')
  })

  it('leaves out an empty address', () => {
    const device = toDevice({ session: sessionOf({ token: 't' }), currentToken: null, now: NOW })
    expect(device.meta).toBe('Last active 5m ago')
  })
})

describe('signedInDevicesOf', () => {
  it('lists the current device first', () => {
    const devices = signedInDevicesOf({
      sessions: [sessionOf({ token: 'a' }), sessionOf({ token: 'b' }), sessionOf({ token: 'c' })],
      currentToken: 'c',
      now: NOW,
    })
    expect(devices.map((device) => device.id)).toEqual(['c', 'a', 'b'])
    expect(devices.map((device) => device.current)).toEqual([true, false, false])
  })
})
