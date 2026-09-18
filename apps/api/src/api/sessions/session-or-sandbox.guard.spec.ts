import type { ExecutionContext } from '@nestjs/common'
import { UnauthorizedException } from '@nestjs/common'
import type { Reflector } from '@nestjs/core'
import { describe, expect, it, vi } from 'vitest'
import type { SessionVerifier } from '../../_core/ports/session-verifier'
import type { CloudSandboxModel } from '../../db'
import type { SandboxesService } from '../sandboxes/sandboxes.service'
import { SessionOrSandboxGuard } from './session-or-sandbox.guard'

const contextWith = (args: {
  params: Record<string, string>
  authorization?: string
}): { context: ExecutionContext; request: { auth?: unknown } } => {
  const request: { params: Record<string, string>; headers: Record<string, string>; auth?: unknown } = {
    params: args.params,
    headers: args.authorization === undefined ? {} : { authorization: args.authorization },
  }
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext
  return { context, request }
}

const reflector = { getAllAndOverride: () => false } as unknown as Reflector

const session = {
  userId: 'user-session',
  sessionId: 'ses_better-auth',
  email: 'dennis@trycomp.ai',
  activeOrganizationId: null,
}

const sandboxRow = (userId: string): CloudSandboxModel =>
  ({ id: 'sbx_1', userId }) as unknown as CloudSandboxModel

describe('SessionOrSandboxGuard', () => {
  it('authenticates a sandbox token as the user the thread belongs to', async () => {
    const verifySessionToken = vi.fn(async () => sandboxRow('user-a'))
    const verify = vi.fn()
    const guard = new SessionOrSandboxGuard(
      { verify } as unknown as SessionVerifier,
      reflector,
      { verifySessionToken } as unknown as SandboxesService,
    )
    const { context, request } = contextWith({
      params: { threadId: 'brn_1' },
      authorization: 'Bearer sandbox-token',
    })

    const allowed = await guard.canActivate(context)

    expect(allowed).toBe(true)
    expect(verifySessionToken).toHaveBeenCalledWith({ threadId: 'brn_1', token: 'sandbox-token' })
    expect(verify).not.toHaveBeenCalled()
    expect(request.auth).toMatchObject({ userId: 'user-a' })
  })

  it('falls back to the user session when the bearer is no sandbox token', async () => {
    const verifySessionToken = vi.fn(async () => {
      throw new UnauthorizedException('a valid sandbox session token is required')
    })
    const verify = vi.fn(async () => session)
    const guard = new SessionOrSandboxGuard(
      { verify } as unknown as SessionVerifier,
      reflector,
      { verifySessionToken } as unknown as SandboxesService,
    )
    const { context, request } = contextWith({
      params: { threadId: 'brn_1' },
      authorization: 'Bearer user-session-token',
    })

    const allowed = await guard.canActivate(context)

    expect(allowed).toBe(true)
    expect(request.auth).toEqual(session)
  })

  it('rejects when neither a sandbox token nor a user session matches', async () => {
    const verifySessionToken = vi.fn(async () => {
      throw new UnauthorizedException('a valid sandbox session token is required')
    })
    const verify = vi.fn(async () => null)
    const guard = new SessionOrSandboxGuard(
      { verify } as unknown as SessionVerifier,
      reflector,
      { verifySessionToken } as unknown as SandboxesService,
    )

    await expect(
      guard.canActivate(
        contextWith({ params: { threadId: 'brn_1' }, authorization: 'Bearer nope' }).context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('asks only for a user session when the route names no thread and the bearer is no sandbox token', async () => {
    const verifySessionToken = vi.fn()
    const verifyTokenPrincipal = vi.fn(async () => null)
    const verify = vi.fn(async () => session)
    const guard = new SessionOrSandboxGuard(
      { verify } as unknown as SessionVerifier,
      reflector,
      { verifySessionToken, verifyTokenPrincipal } as unknown as SandboxesService,
    )

    const allowed = await guard.canActivate(
      contextWith({ params: {}, authorization: 'Bearer user-session-token' }).context,
    )

    expect(allowed).toBe(true)
    expect(verifySessionToken).not.toHaveBeenCalled()
  })

  it('authenticates a sandbox token by its hash alone on routes that name no thread', async () => {
    const verifyTokenPrincipal = vi.fn(async () => sandboxRow('user-a'))
    const verify = vi.fn()
    const guard = new SessionOrSandboxGuard(
      { verify } as unknown as SessionVerifier,
      reflector,
      {
        verifySessionToken: vi.fn(),
        verifyTokenPrincipal,
      } as unknown as SandboxesService,
    )
    const { context, request } = contextWith({
      params: {},
      authorization: 'Bearer sandbox-token',
    })

    const allowed = await guard.canActivate(context)

    expect(allowed).toBe(true)
    expect(verifyTokenPrincipal).toHaveBeenCalledWith({ token: 'sandbox-token' })
    expect(verify).not.toHaveBeenCalled()
    expect(request.auth).toMatchObject({ userId: 'user-a' })
  })
})
