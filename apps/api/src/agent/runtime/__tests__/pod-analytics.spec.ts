import { describe, expect, it } from 'bun:test'

import type { ProductAnalytics, ProductAnalyticsProperties } from '@dltech/atlas-observability'

import { podAnalyticsOf } from '../pod-analytics'

type Captured = { userId: string; event: string; properties?: ProductAnalyticsProperties }

const recorder = (fail = false) => {
  const captured: Captured[] = []
  const analytics: ProductAnalytics = {
    capture: (args) => {
      if (fail) throw new Error('the analytics client is down')
      captured.push(args)
    },
    flush: async () => undefined,
  }
  return { captured, analytics }
}

describe('podAnalyticsOf', () => {
  it('is absent when the host has no product analytics', () => {
    expect(podAnalyticsOf({ analytics: undefined, userId: 'user-1' })).toBeUndefined()
  })

  it('captures under the session user id', () => {
    const { captured, analytics } = recorder()
    podAnalyticsOf({ analytics, userId: 'user-1' })?.capture({
      event: 'quality review completed',
      properties: { status: 'completed' },
    })

    expect(captured).toEqual([
      { userId: 'user-1', event: 'quality review completed', properties: { status: 'completed' } },
    ])
  })

  it('swallows a client that throws', () => {
    const { analytics } = recorder(true)
    const pod = podAnalyticsOf({ analytics, userId: 'user-1' })
    expect(() => pod?.capture({ event: 'e', properties: {} })).not.toThrow()
  })
})
