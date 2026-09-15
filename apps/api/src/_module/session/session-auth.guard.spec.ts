import type { ExecutionContext } from '@nestjs/common'
import { UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { describe, expect, it } from 'vitest'
import { IS_PUBLIC_KEY } from '../../_core/decorators/public.decorator'
import type { SessionVerifier } from '../../_core/ports/session-verifier'
import type { VerifiedSession } from '../../_core/types/auth.types'
import { SessionAuthGuard } from './session-auth.guard'

const SESSION: VerifiedSession = {
  userId: 'user-1',
  sessionId: 'session-1',
  email: 'dennis@atlas.dev',
  activeOrganizationId: null,
}

function verifierReturning(session: VerifiedSession | null): SessionVerifier {
  return { verify: () => Promise.resolve(session) }
}

function contextFor(request: object, isPublic = false): ExecutionContext {
  const handler = () => undefined
  if (isPublic) Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler)
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext
}

describe('SessionAuthGuard', () => {
  it('passes public routes without consulting the verifier', async () => {
    const guard = new SessionAuthGuard(verifierReturning(null), new Reflector())
    await expect(guard.canActivate(contextFor({}, true))).resolves.toBe(true)
  })

  it('rejects requests without a valid session', async () => {
    const guard = new SessionAuthGuard(verifierReturning(null), new Reflector())
    await expect(guard.canActivate(contextFor({ headers: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
  })

  it('attaches the verified session to the request', async () => {
    const guard = new SessionAuthGuard(verifierReturning(SESSION), new Reflector())
    const request: { headers: object; auth?: VerifiedSession } = { headers: {} }
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true)
    expect(request.auth).toEqual(SESSION)
  })
})
