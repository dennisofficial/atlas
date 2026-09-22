import type { ExecutionContext } from '@nestjs/common'
import { UnauthorizedException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { SandboxTokenGuard } from './sandbox-token.guard'
import type { SandboxesService } from './sandboxes.service'

const contextWith = (args: {
  params: Record<string, string>
  authorization?: string
}): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        params: args.params,
        headers: args.authorization === undefined ? {} : { authorization: args.authorization },
      }),
    }),
  }) as unknown as ExecutionContext

describe('SandboxTokenGuard', () => {
  it('verifies the bearer token against the thread it names', async () => {
    const verifySessionToken = vi.fn(async () => ({ threadId: 'brn_1', userId: 'user-a' }))
    const guard = new SandboxTokenGuard({
      verifySessionToken,
    } as unknown as SandboxesService)

    const allowed = await guard.canActivate(
      contextWith({ params: { threadId: 'brn_1' }, authorization: 'Bearer session-token' }),
    )

    expect(allowed).toBe(true)
    expect(verifySessionToken).toHaveBeenCalledWith({
      threadId: 'brn_1',
      token: 'session-token',
    })
  })

  it('refuses a request carrying no bearer token', async () => {
    const guard = new SandboxTokenGuard({
      verifySessionToken: vi.fn(),
    } as unknown as SandboxesService)

    await expect(
      guard.canActivate(contextWith({ params: { threadId: 'brn_1' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException)
    await expect(
      guard.canActivate(contextWith({ params: { threadId: 'brn_1' }, authorization: 'Basic abc' })),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('resolves the thread from the token alone on a route with no :threadId', async () => {
    const verifyTokenPrincipal = vi.fn(async () => ({ threadId: 'brn_resolved', userId: 'user-a' }))
    const guard = new SandboxTokenGuard({
      verifyTokenPrincipal,
    } as unknown as SandboxesService)
    const request = { params: {}, headers: { authorization: 'Bearer sandbox-token' } }

    const allowed = await guard.canActivate({
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext)

    expect(allowed).toBe(true)
    expect(verifyTokenPrincipal).toHaveBeenCalledWith({ token: 'sandbox-token' })
    expect(request).toMatchObject({ sandbox: { threadId: 'brn_resolved' } })
  })

  it('still refuses a threadId-less route without a bearer token', async () => {
    const guard = new SandboxTokenGuard({
      verifyTokenPrincipal: vi.fn(),
    } as unknown as SandboxesService)

    await expect(
      guard.canActivate(contextWith({ params: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
