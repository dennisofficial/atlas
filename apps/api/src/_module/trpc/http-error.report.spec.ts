import { BadRequestException, HttpException, HttpStatus, Logger } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it, vi } from 'bun:test'
import { ErrorReporter, type ErrorReportProperties } from '@dltech/atlas-observability'
import { TRPCError } from '@trpc/server'
import type { MiddlewareOptions } from 'nestjs-trpc'

import { API_FAULT_SOURCE, HttpErrorMiddleware } from './http-error.middleware'

const USER_TEXT = 'fix the login page for alice@example.com'

class RecordingErrors extends ErrorReporter {
  readonly reports: { error: Error; properties: ErrorReportProperties }[] = []

  report(args: { error: Error; properties: ErrorReportProperties }): void {
    this.reports.push(args)
  }
}

const failWith = async (error: unknown): Promise<RecordingErrors> => {
  const errors = new RecordingErrors()
  const middleware = new HttpErrorMiddleware({ errors })
  const options = {
    path: 'sessions.create',
    next: async () => ({ ok: false, error }),
  } as unknown as MiddlewareOptions
  await middleware.use(options).catch(() => undefined)
  return errors
}

describe('HttpErrorMiddleware error reports', () => {
  beforeAll(() => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterAll(() => vi.restoreAllMocks())

  it('reports an unexpected server fault under its root cause class and the procedure', async () => {
    const root = new TypeError(USER_TEXT)
    const fault = new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      cause: new HttpException('wrapped', HttpStatus.INTERNAL_SERVER_ERROR, { cause: root }),
    })

    const errors = await failWith(fault)

    expect(errors.reports).toHaveLength(1)
    expect(errors.reports[0]?.error.name).toBe('TypeError')
    expect(errors.reports[0]?.properties).toEqual({
      source: API_FAULT_SOURCE,
      path: 'sessions.create',
      error_class: 'HttpException',
    })
  })

  it('carries the stack frames of the root cause but none of its message', async () => {
    const root = new Error(USER_TEXT)

    const errors = await failWith(root)
    const reported = errors.reports[0]?.error

    expect(reported?.message).toBe('sessions.create failed')
    expect(reported?.stack).not.toContain(USER_TEXT)
    expect(reported?.stack).toContain('    at ')
  })

  it('reports nothing for a client fault', async () => {
    const errors = await failWith(new BadRequestException('input is invalid'))

    expect(errors.reports).toHaveLength(0)
  })

  it('reports nothing for a tRPC error the router already classified', async () => {
    const errors = await failWith(new TRPCError({ code: 'NOT_FOUND', message: 'no such session' }))

    expect(errors.reports).toHaveLength(0)
  })
})
