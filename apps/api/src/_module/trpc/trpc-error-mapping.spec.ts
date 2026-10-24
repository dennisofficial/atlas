import { HttpStatus } from '@nestjs/common'
import type { TRPC_ERROR_CODE_KEY } from '@trpc/server/rpc'
import { describe, expect, it } from 'bun:test'
import { trpcCodeOf } from './trpc-error-mapping'

describe('trpcCodeOf', () => {
  const cases: readonly [number, TRPC_ERROR_CODE_KEY][] = [
    [HttpStatus.BAD_REQUEST, 'BAD_REQUEST'],
    [HttpStatus.CONFLICT, 'CONFLICT'],
    [HttpStatus.PRECONDITION_FAILED, 'PRECONDITION_FAILED'],
    [HttpStatus.UNPROCESSABLE_ENTITY, 'UNPROCESSABLE_CONTENT'],
    [HttpStatus.TOO_MANY_REQUESTS, 'TOO_MANY_REQUESTS'],
    [HttpStatus.SERVICE_UNAVAILABLE, 'SERVICE_UNAVAILABLE'],
    [HttpStatus.GATEWAY_TIMEOUT, 'GATEWAY_TIMEOUT'],
  ]

  it.each(cases)('maps %i to %s', (status, code) => {
    expect(trpcCodeOf({ status })).toBe(code)
  })

  it('falls back to INTERNAL_SERVER_ERROR for an unmapped status', () => {
    expect(trpcCodeOf({ status: 418 })).toBe('INTERNAL_SERVER_ERROR')
  })
})
