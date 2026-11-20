import { describe, expect, it } from 'bun:test'
import type { PostHog } from 'posthog-node'

import { NullProductAnalytics } from '../../analytics/product-analytics'
import {
  PosthogProductAnalytics,
  serverObservability,
  serverTraceOptions,
} from '../posthog-product-analytics'

type Capture = { distinctId: string; event: string; properties: Record<string, unknown> }

const fakeClient = (args: { throws?: boolean } = {}) => {
  const captures: Capture[] = []
  let shutdowns = 0
  const client = {
    capture: (message: Capture) => {
      if (args.throws === true) throw new Error('queue closed')
      captures.push(message)
    },
    shutdown: async () => {
      shutdowns += 1
    },
  } as unknown as PostHog
  return { client, captures, shutdowns: () => shutdowns }
}

describe('PosthogProductAnalytics', () => {
  it('captures under the Atlas user id with the server base properties', () => {
    const { client, captures } = fakeClient()
    const analytics = new PosthogProductAnalytics({ client, version: '1.2.3' })

    analytics.capture({
      userId: 'user-1',
      event: 'session_created',
      properties: { session_id: 's-1' },
    })

    expect(captures).toEqual([
      {
        distinctId: 'user-1',
        event: 'session_created',
        properties: {
          session_id: 's-1',
          atlas_version: '1.2.3',
          surface: 'server',
          $process_person_profile: true,
        },
      },
    ])
  })

  it('keeps the server base properties when a caller sets its own', () => {
    const { client, captures } = fakeClient()
    const analytics = new PosthogProductAnalytics({ client, version: '1.2.3' })

    analytics.capture({
      userId: 'user-1',
      event: 'sessions_list_timed',
      properties: { surface: 'trpc', atlas_version: 'caller' },
    })

    expect(captures[0]?.properties).toMatchObject({
      surface: 'server',
      atlas_version: '1.2.3',
    })
  })

  it('never throws when the client refuses the event', () => {
    const { client } = fakeClient({ throws: true })
    const analytics = new PosthogProductAnalytics({ client, version: '1.2.3' })

    expect(() => analytics.capture({ userId: 'user-1', event: 'x' })).not.toThrow()
  })

  it('flushes once on shutdown', async () => {
    const { client, shutdowns } = fakeClient()
    const analytics = new PosthogProductAnalytics({ client, version: '1.2.3' })

    await analytics.flush()

    expect(shutdowns()).toBe(1)
  })
})

describe('serverTraceOptions', () => {
  it('sends v2 traces under their own service name so v1 traces stay separable', () => {
    expect(serverTraceOptions('1.2.3')).toEqual({
      serviceName: 'atlas-agent',
      serviceVersion: '1.2.3',
      maxSpanAgeMs: 24 * 60 * 60 * 1000,
    })
  })
})

describe('serverObservability', () => {
  it('hands back null implementations under the test runner', () => {
    const observability = serverObservability({ version: '1.2.3', env: { NODE_ENV: 'test' } })

    expect(observability.analytics).toBeInstanceOf(NullProductAnalytics)
  })

  it('honours an explicit telemetry opt-out', () => {
    const observability = serverObservability({
      version: '1.2.3',
      env: { ATLAS_TELEMETRY: '0' },
    })

    expect(observability.analytics).toBeInstanceOf(NullProductAnalytics)
  })
})
