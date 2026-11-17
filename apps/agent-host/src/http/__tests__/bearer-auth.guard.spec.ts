import { BadRequestException, UnauthorizedException, type ExecutionContext } from '@nestjs/common'
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { MemoryStreamAuth } from '../../stream/memory-stream-auth'
import { BearerAuthGuard } from '../bearer-auth.guard'
import type { HostRequest } from '../host-request'
import { ZodBodyPipe } from '../zod-body.pipe'

const contextOf = (request: HostRequest): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext

const requestOf = (authorization?: string): HostRequest => ({
  url: '/operator-requests/answer',
  headers: authorization === undefined ? {} : { authorization },
})

const authWithToken = (): MemoryStreamAuth => {
  const auth = new MemoryStreamAuth({ now: () => 0 })
  auth.grant({ token: 'tok-a', userId: 'user-a', expiresAt: 3_600_000 })
  return auth
}

describe('BearerAuthGuard', () => {
  it('refuses a request without a bearer and one with an unknown bearer', async () => {
    const guard = new BearerAuthGuard(authWithToken())
    const refusalOf = async (authorization?: string): Promise<unknown> => {
      try {
        await guard.canActivate(contextOf(requestOf(authorization)))
        return undefined
      } catch (error) {
        return error
      }
    }

    const missing = await refusalOf()
    const unknown = await refusalOf('Bearer nobody')

    expect(missing).toBeInstanceOf(UnauthorizedException)
    expect(unknown).toBeInstanceOf(UnauthorizedException)
    expect((missing as UnauthorizedException).getResponse()).toEqual({ reason: 'bearer' })
  })

  it('puts the resolved user on the request', async () => {
    const guard = new BearerAuthGuard(authWithToken())
    const request = requestOf('Bearer tok-a')
    expect(await guard.canActivate(contextOf(request))).toBe(true)
    expect(request.userId).toBe('user-a')
  })
})

describe('ZodBodyPipe', () => {
  const schema = z.strictObject({ sessionId: z.string().min(1) })

  it('answers 400 for a body the schema refuses', () => {
    expect(() => new ZodBodyPipe(schema).transform({ sessionId: '' })).toThrow(BadRequestException)
    expect(() => new ZodBodyPipe(schema).transform({ other: 1 })).toThrow(BadRequestException)
  })

  it('passes a body the schema accepts', () => {
    expect(new ZodBodyPipe(schema).transform({ sessionId: 'ses_1' })).toEqual({
      sessionId: 'ses_1',
    })
  })
})
