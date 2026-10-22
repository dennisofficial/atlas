import type { INestApplication } from '@nestjs/common'
import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  Param,
} from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { Mock } from 'bun:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { GithubUserReadFailed } from './cloud/github/github-user-reads'
import { GlobalExceptionFilter } from './global-exception.filter'

const databaseError = ({ sqlState }: { sqlState: string }): Error =>
  Object.assign(new Error('duplicate key value violates unique constraint on email secret@x.io'), {
    name: 'SqlQueryError',
    sqlState,
    cause: { code: sqlState, constraint: 'User_email_key', detail: 'Key (email)=(secret@x.io) already exists.' },
  })

const noRows = (): Error => Object.assign(new Error('no rows for secret@x.io'), { code: 'RUNTIME.NO_ROWS' })

const THROWERS: Record<string, () => never> = {
  http: () => {
    throw new BadRequestException('nope')
  },
  unique: () => {
    throw databaseError({ sqlState: '23505' })
  },
  missing: () => {
    throw noRows()
  },
  other: () => {
    throw databaseError({ sqlState: '23503' })
  },
  github: () => {
    throw new GithubUserReadFailed('github answered 500 for /repos/a/b: boom', 500)
  },
  timeout: () => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
  },
  abort: () => {
    throw new DOMException('This operation was aborted', 'AbortError')
  },
  unknown: () => {
    throw new Error('connection string postgres://user:pw@host leaked')
  },
  httperror: () => {
    throw Object.assign(new Error('request entity too large'), {
      statusCode: 413,
      status: 413,
      expose: true,
    })
  },
}

@Controller('throwing')
class ThrowingController {
  @Get(':kind')
  throwIt(@Param('kind') kind: string): never {
    const thrower = THROWERS[kind]
    if (thrower === undefined) throw new Error('unknown kind')
    return thrower()
  }
}

describe('GlobalExceptionFilter', () => {
  let app: INestApplication
  let errorLog: Mock<Logger['error']>

  beforeEach(async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    vi.spyOn(Logger, 'error').mockImplementation(() => undefined)
    const module = await Test.createTestingModule({ controllers: [ThrowingController] }).compile()
    app = module.createNestApplication()
    app.useGlobalFilters(new GlobalExceptionFilter(app.get(HttpAdapterHost).httpAdapter))
    await app.init()
  })

  afterEach(async () => {
    await app.close()
    vi.restoreAllMocks()
  })

  const hit = ({ kind }: { kind: string }) => request(app.getHttpServer()).get(`/throwing/${kind}`)

  it('passes an HttpException through unchanged', async () => {
    const response = await hit({ kind: 'http' }).expect(400)
    expect(response.body).toEqual({ statusCode: 400, message: 'nope', error: 'Bad Request' })
  })

  it('maps a unique violation to 409 with its SQLSTATE', async () => {
    const response = await hit({ kind: 'unique' }).expect(409)
    expect(response.body).toEqual({
      statusCode: 409,
      message: 'Resource already exists',
      code: '23505',
    })
  })

  it('maps a no-rows read to 404', async () => {
    const response = await hit({ kind: 'missing' }).expect(404)
    expect(response.body).toEqual({ statusCode: 404, message: 'Resource not found' })
  })

  it('maps any other integrity violation to 400 with its SQLSTATE', async () => {
    const response = await hit({ kind: 'other' }).expect(400)
    expect(response.body).toEqual({ statusCode: 400, message: 'Invalid request', code: '23503' })
  })

  it('never leaks the driver detail or the raw message', async () => {
    const bodies = await Promise.all(
      ['unique', 'missing', 'other'].map(async (kind) => (await hit({ kind })).text),
    )
    for (const body of bodies) {
      expect(body).not.toContain('secret@x.io')
      expect(body).not.toContain('email')
    }
  })

  it('maps GithubUserReadFailed to 502 carrying its sanitized message', async () => {
    const response = await hit({ kind: 'github' }).expect(502)
    expect(response.body).toEqual({
      statusCode: 502,
      message: 'github answered 500 for /repos/a/b: boom',
    })
  })

  it.each(['timeout', 'abort'])('maps a %s DOMException to 502 upstream timed out', async (kind) => {
    const response = await hit({ kind }).expect(502)
    expect(response.body).toEqual({ statusCode: 502, message: 'upstream request timed out' })
  })

  it('maps anything else to a generic 500 and logs the original error', async () => {
    const response = await hit({ kind: 'unknown' }).expect(500)
    expect(response.body).toEqual({ statusCode: 500, message: 'Internal server error' })
    expect(response.text).not.toContain('postgres://')
    expect(errorLog).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('postgres://') }))
  })

  it('keeps a 4xx http-errors style error as its own status', async () => {
    const response = await hit({ kind: 'httperror' }).expect(413)
    expect(response.body).toEqual({ statusCode: 413, message: 'request entity too large' })
  })
})
