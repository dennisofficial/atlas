import type { ExecutionContext } from '@nestjs/common'
import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import type { Reflector } from '@nestjs/core'
import { describe, expect, it, vi } from 'vitest'
import { SANDBOX_REACHABLE_KEY } from '../../_core/decorators/sandbox-reachable.decorator'
import type { SessionVerifier } from '../../_core/ports/session-verifier'
import type { CloudSandboxModel } from '../../db'
import type { SandboxesService } from '../sandboxes/sandboxes.service'
import { SessionOrSandboxGuard } from './session-or-sandbox.guard'

const contextWith = (args: {
  params: Record<string, string>
  authorization?: string
}): { context: ExecutionContext; request: { auth?: unknown; sandbox?: unknown } } => {
  const request: {
    params: Record<string, string>
    headers: Record<string, string>
    auth?: unknown
    sandbox?: unknown
  } = {
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

const sandboxReachableReflector = {
  getAllAndOverride: (key: string) => key === SANDBOX_REACHABLE_KEY,
} as unknown as Reflector

const session = {
  userId: 'user-session',
  sessionId: 'ses_better-auth',
  email: 'dennis@trycomp.ai',
  activeOrganizationId: null,
}

const sandboxRow = (userId: string): CloudSandboxModel =>
  ({ id: 'sbx_1', userId, threadId: 'brn_1' }) as unknown as CloudSandboxModel

const guardWith = (args: {
  verifier: SessionVerifier
  sandboxes: Record<string, unknown>
  reflector?: Reflector
}): SessionOrSandboxGuard =>
  new SessionOrSandboxGuard(
    args.verifier,
    args.reflector ?? reflector,
    args.sandboxes as unknown as SandboxesService,
  )

describe('SessionOrSandboxGuard', () => {
  it('authenticates a sandbox token as the user the thread belongs to', async () => {
    const verifyTokenPrincipal = vi.fn(async () => sandboxRow('user-a'))
    const assertThreadInFamily = vi.fn(async () => undefined)
    const verify = vi.fn()
    const guard = guardWith({
      verifier: { verify } as unknown as SessionVerifier,
      sandboxes: { verifyTokenPrincipal, assertThreadInFamily },
    })
    const { context, request } = contextWith({
      params: { threadId: 'brn_1' },
      authorization: 'Bearer sandbox-token',
    })

    const allowed = await guard.canActivate(context)

    expect(allowed).toBe(true)
    expect(verifyTokenPrincipal).toHaveBeenCalledWith({ token: 'sandbox-token' })
    expect(assertThreadInFamily).toHaveBeenCalledWith({
      sandboxThreadId: 'brn_1',
      threadId: 'brn_1',
    })
    expect(verify).not.toHaveBeenCalled()
    expect(request.auth).toMatchObject({ userId: 'user-a' })
    expect(request.sandbox).toEqual({ sandboxId: 'sbx_1', threadId: 'brn_1' })
  })

  it("authenticates a sandbox token against a sub-agent thread of the sandbox's family", async () => {
    const verifyTokenPrincipal = vi.fn(async () => sandboxRow('user-a'))
    const assertThreadInFamily = vi.fn(async () => undefined)
    const guard = guardWith({
      verifier: { verify: vi.fn() } as unknown as SessionVerifier,
      sandboxes: { verifyTokenPrincipal, assertThreadInFamily },
    })
    const { context, request } = contextWith({
      params: { threadId: 'brn_child' },
      authorization: 'Bearer sandbox-token',
    })

    const allowed = await guard.canActivate(context)

    expect(allowed).toBe(true)
    expect(assertThreadInFamily).toHaveBeenCalledWith({
      sandboxThreadId: 'brn_1',
      threadId: 'brn_child',
    })
    expect(request.auth).toMatchObject({ userId: 'user-a' })
  })

  it('rejects a sandbox token reaching a thread outside its family', async () => {
    const verifyTokenPrincipal = vi.fn(async () => sandboxRow('user-a'))
    const assertThreadInFamily = vi.fn(async () => {
      throw new UnauthorizedException(
        'the sandbox token reaches only its own thread and its sub-agents',
      )
    })
    const guard = guardWith({
      verifier: { verify: vi.fn() } as unknown as SessionVerifier,
      sandboxes: { verifyTokenPrincipal, assertThreadInFamily },
    })

    await expect(
      guard.canActivate(
        contextWith({ params: { threadId: 'brn_elsewhere' }, authorization: 'Bearer sandbox-token' })
          .context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('falls back to the user session when the bearer is no sandbox token', async () => {
    const verifyTokenPrincipal = vi.fn(async () => {
      throw new UnauthorizedException('a valid sandbox session token is required')
    })
    const verify = vi.fn(async () => session)
    const guard = guardWith({
      verifier: { verify } as unknown as SessionVerifier,
      sandboxes: { verifyTokenPrincipal },
    })
    const { context, request } = contextWith({
      params: { threadId: 'brn_1' },
      authorization: 'Bearer user-session-token',
    })

    const allowed = await guard.canActivate(context)

    expect(allowed).toBe(true)
    expect(request.auth).toEqual(session)
  })

  it('rejects when neither a sandbox token nor a user session matches', async () => {
    const verifyTokenPrincipal = vi.fn(async () => {
      throw new UnauthorizedException('a valid sandbox session token is required')
    })
    const verify = vi.fn(async () => null)
    const guard = guardWith({
      verifier: { verify } as unknown as SessionVerifier,
      sandboxes: { verifyTokenPrincipal },
    })

    await expect(
      guard.canActivate(
        contextWith({ params: { threadId: 'brn_1' }, authorization: 'Bearer nope' }).context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('asks only for a user session when the route names no thread and the bearer is no sandbox token', async () => {
    const verifyTokenPrincipal = vi.fn(async () => null)
    const assertThreadInFamily = vi.fn(async () => undefined)
    const verify = vi.fn(async () => session)
    const guard = guardWith({
      verifier: { verify } as unknown as SessionVerifier,
      sandboxes: { verifyTokenPrincipal, assertThreadInFamily },
    })

    const allowed = await guard.canActivate(
      contextWith({ params: {}, authorization: 'Bearer user-session-token' }).context,
    )

    expect(allowed).toBe(true)
    expect(assertThreadInFamily).not.toHaveBeenCalled()
  })

  it('refuses a sandbox token on a threadless route that has not opted in', async () => {
    const verifyTokenPrincipal = vi.fn(async () => sandboxRow('user-a'))
    const assertThreadInFamily = vi.fn(async () => undefined)
    const verify = vi.fn()
    const guard = guardWith({
      verifier: { verify } as unknown as SessionVerifier,
      sandboxes: { verifyTokenPrincipal, assertThreadInFamily },
    })
    const { context, request } = contextWith({
      params: {},
      authorization: 'Bearer sandbox-token',
    })

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException)

    expect(verifyTokenPrincipal).toHaveBeenCalledWith({ token: 'sandbox-token' })
    expect(assertThreadInFamily).not.toHaveBeenCalled()
    expect(verify).not.toHaveBeenCalled()
    expect(request.auth).toBeUndefined()
  })

  it('admits a sandbox token on a threadless route that opted in with @SandboxReachable', async () => {
    const verifyTokenPrincipal = vi.fn(async () => sandboxRow('user-a'))
    const assertThreadInFamily = vi.fn(async () => undefined)
    const verify = vi.fn()
    const guard = guardWith({
      verifier: { verify } as unknown as SessionVerifier,
      sandboxes: { verifyTokenPrincipal, assertThreadInFamily },
      reflector: sandboxReachableReflector,
    })
    const { context, request } = contextWith({
      params: {},
      authorization: 'Bearer sandbox-token',
    })

    const allowed = await guard.canActivate(context)

    expect(allowed).toBe(true)
    expect(verifyTokenPrincipal).toHaveBeenCalledWith({ token: 'sandbox-token' })
    expect(assertThreadInFamily).not.toHaveBeenCalled()
    expect(verify).not.toHaveBeenCalled()
    expect(request.auth).toMatchObject({ userId: 'user-a' })
    expect(request.sandbox).toEqual({ sandboxId: 'sbx_1', threadId: 'brn_1' })
  })
})
