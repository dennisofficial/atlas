import { describe, expect, it } from 'bun:test'
import type { CallHandler, ExecutionContext } from '@nestjs/common'
import { ProductAnalytics } from '@dltech/atlas-observability'
import { lastValueFrom, of, throwError } from 'rxjs'

import {
  ApiLatencyInterceptor,
  requestPathOf,
  type AuthenticatedRequest,
} from './api-latency.interceptor'

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

const requestOf = (over: { path?: string; route?: { path?: string } } = {}): AuthenticatedRequest =>
  ({
    path: over.path ?? '/v1/trpc/sessions.list',
    route: over.route,
    headers: {},
    user: { id: 'user-1' },
  }) as unknown as AuthenticatedRequest

const contextOf = (request: AuthenticatedRequest): ExecutionContext =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ statusCode: 200 }),
    }),
  }) as unknown as ExecutionContext

const handlerOf = (handle: CallHandler['handle']): CallHandler => ({ handle })

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

const setup = (times: { at: number }) => {
  const analytics = new FakeAnalytics()
  const interceptor = new ApiLatencyInterceptor({
    analytics,
    userIdOf: async () => 'user-1',
    now: () => times.at,
  })
  return { analytics, interceptor }
}

describe('ApiLatencyInterceptor', () => {
  it('stays quiet below the slow threshold', async () => {
    const times = { at: 0 }
    const { analytics, interceptor } = setup(times)
    const context = contextOf(requestOf())

    const result = interceptor.intercept(
      context,
      handlerOf(() => of('ok')),
    )
    times.at = 999
    await lastValueFrom(result)
    await flushMicrotasks()

    expect(analytics.captured).toEqual([])
  })

  it('captures a request at or above one second', async () => {
    const times = { at: 0 }
    const { analytics, interceptor } = setup(times)
    const context = contextOf(requestOf({ path: '/v1/trpc/sessions.list?batch=0' }))

    const result = interceptor.intercept(
      context,
      handlerOf(() => of('ok')),
    )
    times.at = 1000
    await lastValueFrom(result)
    await flushMicrotasks()

    expect(analytics.captured).toEqual([
      {
        userId: 'user-1',
        event: 'api_request',
        properties: { path: 'sessions.list', duration_ms: 1000, status: 200, failed: false },
      },
    ])
  })

  it('captures a failed request however fast it was', async () => {
    const times = { at: 0 }
    const { analytics, interceptor } = setup(times)
    const context = contextOf(requestOf({ path: '/v1/trpc/sessions.post' }))

    const result = interceptor.intercept(
      context,
      handlerOf(() => throwError(() => new Error('boom'))),
    )
    times.at = 5
    await expect(lastValueFrom(result)).rejects.toThrow('boom')
    await flushMicrotasks()

    expect(analytics.captured[0]).toMatchObject({
      event: 'api_request',
      properties: { path: 'sessions.post', status: 500, failed: true },
    })
  })

  it('skips an unauthenticated request', async () => {
    const times = { at: 0 }
    const analytics = new FakeAnalytics()
    const interceptor = new ApiLatencyInterceptor({
      analytics,
      userIdOf: async () => undefined,
      now: () => times.at,
    })
    const result = interceptor.intercept(
      contextOf(requestOf()),
      handlerOf(() => of('ok')),
    )
    times.at = 5000
    await lastValueFrom(result)
    await flushMicrotasks()

    expect(analytics.captured).toEqual([])
  })
})

describe('requestPathOf', () => {
  it('reads the tRPC procedure without the query string', () => {
    expect(requestPathOf({ path: '/v1/trpc/sessions.list?batch=0' } as never)).toBe('sessions.list')
  })

  it('masks ids in an Express route fallback', () => {
    expect(
      requestPathOf({
        path: '/v1/sessions/123e4567-e89b-12d3-a456-426614174000',
      } as never),
    ).toBe('/v1/sessions/:id')
  })
})
