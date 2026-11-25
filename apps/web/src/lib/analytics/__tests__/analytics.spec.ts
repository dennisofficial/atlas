import { afterEach, describe, expect, it } from 'bun:test'

import {
  type AnalyticsClient,
  captureException,
  identifyUser,
  initAnalytics,
  isAnalyticsEnabled,
  isBenignException,
  resetAnalytics,
  resetAnalyticsForTests,
  superPropsOf,
  track,
  trackBeforeUnload,
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

describe('trackBeforeUnload', () => {
  it('sends the event by beacon so it leaves a page that is going away', () => {
    const { client, calls } = fakeClient()
    initAnalytics({ enabled: true, client })
    trackBeforeUnload('route_navigated', { outcome: 'abandoned' })
    expect(calls).toEqual([
      {
        name: 'capture',
        args: ['route_navigated', { outcome: 'abandoned' }, { transport: 'sendBeacon' }],
      },
    ])
  })

  it('no-ops when analytics is disabled', () => {
    const { client, calls } = fakeClient()
    initAnalytics({ enabled: false, client })
    trackBeforeUnload('route_navigated')
    expect(calls).toEqual([])
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
      { name: 'captureException', args: [error, {}] },
    ])
  })

  it('attaches the reference id so the exception can be searched for', () => {
    const { client, calls } = fakeClient()
    initAnalytics({ enabled: true, client })
    const error = new Error('boom')
    captureException(error, { reference_id: 'err_abc', request_id: 'req_abc' })
    expect(calls).toEqual([
      {
        name: 'captureException',
        args: [error, { reference_id: 'err_abc', request_id: 'req_abc' }],
      },
    ])
  })

  it('reports an exception even before the provider has initialised', () => {
    expect(() => captureException(new Error('boom'), { reference_id: 'err_abc' })).not.toThrow()
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

describe('isBenignException', () => {
  const exception = (...values: string[]) => ({
    event: '$exception',
    properties: { $exception_list: values.map((value) => ({ type: 'Error', value })) },
  })

  it('drops the ResizeObserver loop notice that browsers raise harmlessly', () => {
    expect(
      isBenignException(exception('ResizeObserver loop completed with undelivered notifications.')),
    ).toBe(true)
  })

  it('keeps a real exception, and one that carries a real error beside the notice', () => {
    expect(isBenignException(exception('route parameter "subdomain" is missing'))).toBe(false)
    expect(
      isBenignException(exception('ResizeObserver loop limit exceeded', 'Cannot read x of null')),
    ).toBe(false)
  })

  it('keeps events that are not exceptions and exceptions with no message', () => {
    expect(isBenignException({ event: 'app_loaded', properties: {} })).toBe(false)
    expect(isBenignException({ event: '$exception', properties: {} })).toBe(false)
  })
})
