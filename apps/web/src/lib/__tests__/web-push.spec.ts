import { describe, expect, it } from 'bun:test'

import {
  applicationServerKeyOf,
  closeSessionNotifications,
  deviceLabelOf,
  registerDeviceInputOf,
} from '../web-push'

const subscriptionOf = (keys: Record<string, string> | undefined) => ({
  endpoint: 'https://push.example/endpoint-1',
  toJSON: () => (keys === undefined ? { endpoint: 'https://push.example/endpoint-1' } : { keys }),
})

describe('applicationServerKeyOf', () => {
  it('decodes a url-safe base64 key into bytes', () => {
    const key = applicationServerKeyOf('BAAB')

    expect([...key]).toEqual([4, 0, 1])
  })

  it('accepts an unpadded key', () => {
    expect([...applicationServerKeyOf('BAABAg')]).toEqual([4, 0, 1, 2])
  })
})

describe('registerDeviceInputOf', () => {
  it('builds the web push device the API expects', () => {
    expect(
      registerDeviceInputOf({
        subscription: subscriptionOf({ p256dh: 'public-key', auth: 'auth-secret' }),
        clientId: 'client-a',
        label: 'Chrome',
      }),
    ).toEqual({
      kind: 'web-push',
      clientId: 'client-a',
      token: 'https://push.example/endpoint-1',
      secret: JSON.stringify({ p256dh: 'public-key', auth: 'auth-secret' }),
      label: 'Chrome',
    })
  })

  it('refuses a subscription without keys', () => {
    expect(() =>
      registerDeviceInputOf({
        subscription: subscriptionOf(undefined),
        clientId: 'client-a',
        label: 'Chrome',
      }),
    ).toThrow()
  })
})

describe('deviceLabelOf', () => {
  it('names a Home Screen app before the browser', () => {
    expect(
      deviceLabelOf({ standalone: true, userAgent: 'Mozilla/5.0 (iPhone) Safari/604.1' }),
    ).toBe('Home Screen')
  })

  it('names the browser family', () => {
    expect(deviceLabelOf({ standalone: false, userAgent: 'Mozilla/5.0 Chrome/131.0' })).toBe(
      'Chrome',
    )
    expect(deviceLabelOf({ standalone: false, userAgent: 'Mozilla/5.0 Firefox/133.0' })).toBe(
      'Firefox',
    )
    expect(deviceLabelOf({ standalone: false, userAgent: 'Mozilla/5.0 Safari/605.1' })).toBe(
      'Safari',
    )
    expect(deviceLabelOf({ standalone: false, userAgent: 'something else' })).toBe('Browser')
  })
})

describe('closeSessionNotifications', () => {
  it('closes every shown notification tagged with the session', async () => {
    const closed: string[] = []
    Object.defineProperty(globalThis.navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: async () => ({
          getNotifications: async ({ tag }: { tag: string }) => [
            {
              close: async () => {
                closed.push(tag)
              },
            },
            {
              close: async () => {
                closed.push(tag)
              },
            },
          ],
        }),
      },
    })

    await closeSessionNotifications('session-1')

    expect(closed).toEqual(['session-1', 'session-1'])
  })

  it('does nothing when no service worker is installed', async () => {
    Object.defineProperty(globalThis.navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration: async () => undefined },
    })

    await closeSessionNotifications('session-1')

    expect('serviceWorker' in navigator).toBe(true)
  })

  it('does nothing in a browser without a service worker', async () => {
    delete (globalThis.navigator as { serviceWorker?: unknown }).serviceWorker

    await closeSessionNotifications('session-1')

    expect('serviceWorker' in navigator).toBe(false)
  })
})
