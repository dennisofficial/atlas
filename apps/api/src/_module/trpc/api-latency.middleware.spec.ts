import { describe, expect, it } from 'bun:test'
import { ProductAnalytics } from '@dltech/atlas-observability'
import type { MiddlewareOptions } from 'nestjs-trpc'

import type { AuthenticatedRequest } from '../../api/api-latency.interceptor'
import { ApiLatencyMiddleware } from './api-latency.middleware'

type Captured = { userId: string; event: string; properties: Record<string, unknown> }

class FakeAnalytics extends ProductAnalytics {
  readonly captured: Captured[] = []

  capture(args: { userId: string; event: string; properties?: Record<string, unknown> }): void {
    this.captured.push({
      userId: args.userId,
      event: args.event,
      properties: args.properties ?? {},
    })
  }

  async flush(): Promise<void> {}
}

const ctxOf = (): object => ({
  req: { headers: {}, user: { id: 'user-1' } } as unknown as AuthenticatedRequest,
  bearerToken: undefined,
  clientVersion: undefined,
})

const optionsOf = (args: {
  next: () => Promise<{ ok: true; data: unknown } | { ok: false; error: unknown }>
  type?: 'query' | 'mutation' | 'subscription'
  path?: string
}): MiddlewareOptions =>
  ({
    ctx: ctxOf(),
    type: args.type ?? 'query',
    path: args.path ?? 'sessions.list',
    input: undefined,
    getRawInput: async () => undefined,
    meta: undefined,
    signal: undefined,
    next: args.next,
  }) as unknown as MiddlewareOptions

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

const setup = (times: { at: number }) => {
  const analytics = new FakeAnalytics()
  const middleware = new ApiLatencyMiddleware({
    analytics,
    userIdOf: async () => 'user-1',
    now: () => times.at,
  })
  return { analytics, middleware }
}

describe('ApiLatencyMiddleware', () => {
  it('stays quiet below the slow threshold', async () => {
    const times = { at: 0 }
    const { analytics, middleware } = setup(times)

    const pending = middleware.use(optionsOf({ next: async () => ({ ok: true, data: 'ok' }) }))
    times.at = 999
    await pending
    await flushMicrotasks()

    expect(analytics.captured).toEqual([])
  })

  it('captures a tRPC call at or above one second, with the procedure path', async () => {
    const times = { at: 0 }
    const { analytics, middleware } = setup(times)

    const pending = middleware.use(optionsOf({ next: async () => ({ ok: true, data: 'ok' }) }))
    times.at = 1000
    await pending
    await flushMicrotasks()

    expect(analytics.captured).toEqual([
      {
        userId: 'user-1',
        event: 'api_request',
        properties: { path: 'sessions.list', duration_ms: 1000, status: 200, failed: false },
      },
    ])
  })

  it('captures a fast failure with the status its tRPC code maps to', async () => {
    const times = { at: 0 }
    const { analytics, middleware } = setup(times)

    const pending = middleware.use(
      optionsOf({
        path: 'sessions.post',
        next: async () => ({ ok: false, error: { code: 'NOT_FOUND' } }),
      }),
    )
    times.at = 5
    await pending
    await flushMicrotasks()

    expect(analytics.captured[0]?.properties).toEqual({
      path: 'sessions.post',
      duration_ms: 5,
      status: 404,
      failed: true,
    })
  })

  it('records a thrown middleware failure and rethrows it', async () => {
    const times = { at: 0 }
    const { analytics, middleware } = setup(times)

    const pending = middleware.use(
      optionsOf({
        next: async () => {
          throw { code: 'TOO_MANY_REQUESTS' }
        },
      }),
    )
    times.at = 3
    await expect(pending).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' })
    await flushMicrotasks()

    expect(analytics.captured[0]?.properties).toMatchObject({ status: 429, failed: true })
  })

  it('never measures a subscription', async () => {
    const times = { at: 0 }
    const { analytics, middleware } = setup(times)

    const result = await middleware.use(
      optionsOf({ type: 'subscription', next: async () => ({ ok: true, data: 'ok' }) }),
    )
    times.at = 5000
    await flushMicrotasks()

    expect(result).toEqual({ ok: true, data: 'ok' })
    expect(analytics.captured).toEqual([])
  })

  it('never faults the call when analytics throws', async () => {
    const times = { at: 0 }
    const failing = new (class extends ProductAnalytics {
      capture(): void {
        throw new Error('capture failed')
      }

      async flush(): Promise<void> {}
    })()
    const middleware = new ApiLatencyMiddleware({
      analytics: failing,
      userIdOf: async () => 'user-1',
      now: () => times.at,
    })

    const pending = middleware.use(optionsOf({ next: async () => ({ ok: true, data: 'ok' }) }))
    times.at = 4000
    await expect(pending).resolves.toEqual({ ok: true, data: 'ok' })
    await flushMicrotasks()
  })
})
