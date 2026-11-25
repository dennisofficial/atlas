import { describe, expect, it } from 'bun:test'

import type { ProductAnalytics, ProductAnalyticsProperties } from '@dltech/atlas-observability'

import { EPodStart } from '@dltech/atlas-pods/sandbox/sandbox-provider'

import { daemonRestartedOf, podAnalyticsOf, podStartedOf } from '../pod-analytics'

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

describe('podStartedOf', () => {
  it('reports a started pod with its reason, its provider, its session and its wake time', () => {
    expect(
      podStartedOf({
        start: EPodStart.Created,
        provider: 'agent37',
        sessionId: 'session-1',
        wakeMs: 1234,
      }),
    ).toEqual({
      event: 'pod_started',
      properties: {
        reason: EPodStart.Created,
        provider: 'agent37',
        session_id: 'session-1',
        wake_ms: 1234,
      },
    })
  })

  it('stays quiet for a pod that was already running or reported nothing', () => {
    const base = { provider: 'vercel', sessionId: 'session-1', wakeMs: 5 }
    expect(podStartedOf({ ...base, start: EPodStart.Running })).toBeUndefined()
    expect(podStartedOf({ ...base, start: undefined })).toBeUndefined()
  })
})

describe('daemonRestartedOf', () => {
  it('reports a daemon restart with no wake time', () => {
    expect(daemonRestartedOf({ provider: 'vercel', sessionId: 'session-1' })).toEqual({
      event: 'pod_started',
      properties: { reason: 'daemon_restart', provider: 'vercel', session_id: 'session-1' },
    })
  })
})
