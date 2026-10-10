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
import type { MockInstance } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '../generated/prisma/client'
import { GithubUserReadFailed } from './cloud/github/github-user-reads'
import { GlobalExceptionFilter } from './global-exception.filter'

const LEAKY_META = { target: ['email'], driverAdapterError: { cause: { value: 'secret@x.io' } } }

const prismaError = ({ code }: { code: string }): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed on secret@x.io', {
    code,
    clientVersion: 'test',
    meta: LEAKY_META,
  })

const THROWERS: Record<string, () => never> = {
  http: () => {
    throw new BadRequestException('nope')
  },
  unique: () => {
    throw prismaError({ code: 'P2002' })
  },
  missing: () => {
    throw prismaError({ code: 'P2025' })
  },
  other: () => {
    throw prismaError({ code: 'P2003' })
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
    throw Object.assign(new Error('request entity too large'), { statusCode: 413 })
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
  let errorLog: MockInstance<Logger['error']>

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

  it('maps a Prisma P2002 unique violation to 409 with the code', async () => {
    const response = await hit({ kind: 'unique' }).expect(409)
    expect(response.body).toEqual({
      statusCode: 409,
      message: 'Resource already exists',
      code: 'P2002',
    })
  })

  it('maps a Prisma P2025 missing record to 404 with the code', async () => {
    const response = await hit({ kind: 'missing' }).expect(404)
    expect(response.body).toEqual({
      statusCode: 404,
      message: 'Resource not found',
      code: 'P2025',
    })
  })

  it('maps any other Prisma known-request code to 400 with the code', async () => {
    const response = await hit({ kind: 'other' }).expect(400)
    expect(response.body).toEqual({ statusCode: 400, message: 'Invalid request', code: 'P2003' })
  })

  it('never leaks Prisma meta or the raw message', async () => {
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
