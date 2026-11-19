import { afterEach, describe, expect, it } from 'bun:test'

import {
  type AnalyticsClient,
  captureException,
  identifyUser,
  initAnalytics,
  isAnalyticsEnabled,
  resetAnalytics,
  resetAnalyticsForTests,
  superPropsOf,
  track,
} from '../analytics'

interface RecordedCall {
  name: string
  args: unknown[]
}

function fakeClient(): { client: AnalyticsClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push({ name, args })
    }
  return {
    calls,
    client: {
      capture: record('capture'),
      identify: record('identify'),
      reset: record('reset'),
      captureException: record('captureException'),
    },
  }
}

afterEach(() => {
  resetAnalyticsForTests()
})

describe('isAnalyticsEnabled', () => {
  it('is off in tests even when the flag is set', () => {
    expect(isAnalyticsEnabled({ NODE_ENV: 'test', NEXT_PUBLIC_POSTHOG_ENABLED: '1' })).toBe(false)
  })

  it('is on in production', () => {
    expect(isAnalyticsEnabled({ NODE_ENV: 'production' })).toBe(true)
  })

  it('is on outside production only when the flag is set', () => {
    expect(isAnalyticsEnabled({ NODE_ENV: 'development' })).toBe(false)
    expect(isAnalyticsEnabled({ NODE_ENV: 'development', NEXT_PUBLIC_POSTHOG_ENABLED: '1' })).toBe(
      true,
    )
  })
})

describe('track', () => {
  it('no-ops when analytics is disabled', () => {
    const { client, calls } = fakeClient()
    initAnalytics({ enabled: false, client })
    track('app_loaded', { ttfb_ms: 12 })
    expect(calls).toEqual([])
  })

  it('forwards events and props once initialised', () => {
    const { client, calls } = fakeClient()
    initAnalytics({ enabled: true, client })
    track('app_loaded', { ttfb_ms: 12 })
    expect(calls).toEqual([{ name: 'capture', args: ['app_loaded', { ttfb_ms: 12 }] }])
  })
})

describe('identifyUser', () => {
  it('identifies with the account userId', () => {
    const { client, calls } = fakeClient()
    initAnalytics({ enabled: true, client })
    identifyUser('user_42', { email: 'ada@atlas.dev' })
    expect(calls).toEqual([{ name: 'identify', args: ['user_42', { email: 'ada@atlas.dev' }] }])
  })

  it('no-ops when analytics is disabled', () => {
    const { client, calls } = fakeClient()
    initAnalytics({ enabled: false, client })
    identifyUser('user_42')
    expect(calls).toEqual([])
  })
})

describe('resetAnalytics and captureException', () => {
  it('forwards resets and exceptions to the client', () => {
    const { client, calls } = fakeClient()
    initAnalytics({ enabled: true, client })
    resetAnalytics()
    const error = new Error('boom')
    captureException(error)
    expect(calls).toEqual([
      { name: 'reset', args: [] },
      { name: 'captureException', args: [error] },
    ])
  })
})

describe('superPropsOf', () => {
  it('marks the Mac host as the mac surface', () => {
    expect(superPropsOf({ host: { atlasDesktop: {} }, commit: '5e0c2e2abc1234' })).toEqual({
      surface: 'mac',
      interface_version: '5e0c2e2',
    })
  })

  it('marks plain browsers as the web surface', () => {
    expect(superPropsOf({ host: {}, commit: '' })).toEqual({
      surface: 'web',
      interface_version: '',
    })
  })
})
