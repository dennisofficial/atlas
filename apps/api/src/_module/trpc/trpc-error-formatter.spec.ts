import { describe, expect, it } from 'bun:test'
import { TRPCError, type TRPCDefaultErrorShape } from '@trpc/server'
import { withRequestId } from '../../api/request-id.middleware'
import { apiErrorFormatter } from './trpc-error-formatter'

const SHAPE: TRPCDefaultErrorShape = {
  message: 'Internal server error',
  code: -32603,
  data: {
    code: 'INTERNAL_SERVER_ERROR',
    httpStatus: 500,
    path: 'threads.list',
    stack: 'Error: boom\n    at threads.list',
  },
}

const failure = new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'boom' })

const format = (shape: TRPCDefaultErrorShape) =>
  apiErrorFormatter({
    error: failure,
    type: 'query',
    path: 'threads.list',
    input: {},
    ctx: {},
    shape,
  })

const dataOf = (formatted: { data: unknown }): Record<string, unknown> =>
  formatted.data as Record<string, unknown>

describe('apiErrorFormatter', () => {
  it('drops the stack', () => {
    expect(dataOf(format(SHAPE)).stack).toBeUndefined()
  })

  it('reports the request id of the request that failed', () => {
    const formatted = withRequestId('req_abc', () => format(SHAPE))
    expect(dataOf(formatted).requestId).toBe('req_abc')
  })

  it('reports no request id outside a request', () => {
    expect(dataOf(format(SHAPE)).requestId).toBeUndefined()
  })
})
