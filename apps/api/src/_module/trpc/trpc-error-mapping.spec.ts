import type { Logger } from '@nestjs/common'
import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common'
import { describe, expect, it } from 'bun:test'
import type { TRPC_ERROR_CODE_KEY } from '@trpc/server/rpc'
import { detailsOf, toTrpcError, trpcCodeOf } from './trpc-error-mapping'

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

const LEAKED_DSN = 'postgres://user:pw@host refused the connection'

const recordingLog = () => {
  const errors: unknown[] = []
  const warnings: unknown[] = []
  const log = {
    warn: (message: unknown) => {
      warnings.push(message)
    },
    error: (message: unknown) => {
      errors.push(message)
    },
  } satisfies Pick<Logger, 'warn' | 'error'>
  return { log, errors, warnings }
}

const logged = (errors: unknown[]): string => errors.map((entry) => String(entry)).join('\n')

const serverFailure = (): HttpException =>
  new HttpException(LEAKED_DSN, HttpStatus.INTERNAL_SERVER_ERROR, {
    cause: new Error('pod boot failed', { cause: new Error('BlobAccessError: Access denied') }),
  })

describe('toTrpcError', () => {
  it('answers a generic 500 while logging the original error and its cause chain', () => {
    const { log, errors } = recordingLog()

    const error = toTrpcError({ failure: serverFailure(), log })

    expect(error.code).toBe('INTERNAL_SERVER_ERROR')
    expect(error.message).toBe('Internal server error')
    expect(logged(errors)).toContain(LEAKED_DSN)
    expect(logged(errors)).toContain('BlobAccessError: Access denied')
  })

  it('logs an unmapped error and its cause once', () => {
    const { log, errors } = recordingLog()
    const failure = new Error('blob read failed', { cause: new Error('BlobAccessError: denied') })

    const error = toTrpcError({ failure, log })

    expect(error.message).toBe('Internal server error')
    expect(errors).toHaveLength(1)
    expect(logged(errors)).toContain('BlobAccessError: denied')
  })

  it('keeps the message of a client-facing 4xx and logs nothing at error level', () => {
    const { log, errors } = recordingLog()

    const error = toTrpcError({ failure: new BadRequestException('input is invalid'), log })

    expect(error.code).toBe('BAD_REQUEST')
    expect(error.message).toBe('input is invalid')
    expect(errors).toEqual([])
  })
})

describe('detailsOf', () => {
  it('exposes the response of a client-facing exception only', () => {
    expect(detailsOf(new BadRequestException('nope'))).toMatchObject({ statusCode: 400 })
    expect(detailsOf(serverFailure())).toBeUndefined()
    expect(detailsOf(new Error('boom'))).toBeUndefined()
  })
})
