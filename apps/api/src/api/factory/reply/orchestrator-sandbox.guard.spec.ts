import type { ExecutionContext } from '@nestjs/common'
import { UnauthorizedException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import type { SandboxesService } from '../../sandboxes/sandboxes.service'
import { OrchestratorSandboxGuard, type OrchestratorSandboxRequest } from './orchestrator-sandbox.guard'

const SANDBOX_ROW = { id: 'csb_1', threadId: 'brn_orchestrator', userId: 'usr_factory' }

function contextWith(headers: Record<string, string | undefined>): {
  context: ExecutionContext
  request: OrchestratorSandboxRequest
} {
  const request = { headers } as unknown as OrchestratorSandboxRequest
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext
  return { context, request }
}

describe('OrchestratorSandboxGuard', () => {
  it('attaches the sandbox row for a valid bearer token', async () => {
    const sandboxes = { verifyTokenPrincipal: vi.fn(async () => SANDBOX_ROW) }
    const guard = new OrchestratorSandboxGuard(sandboxes as unknown as SandboxesService)
    const { context, request } = contextWith({ authorization: 'Bearer tok_live' })

    expect(await guard.canActivate(context)).toBe(true)
    expect(sandboxes.verifyTokenPrincipal).toHaveBeenCalledWith({ token: 'tok_live' })
    expect(request.orchestratorSandbox).toEqual(SANDBOX_ROW)
  })

  it('rejects a missing or non-bearer authorization header', async () => {
    const sandboxes = { verifyTokenPrincipal: vi.fn() }
    const guard = new OrchestratorSandboxGuard(sandboxes as unknown as SandboxesService)

    await expect(guard.canActivate(contextWith({}).context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
    await expect(
      guard.canActivate(contextWith({ authorization: 'Basic abc' }).context),
    ).rejects.toBeInstanceOf(UnauthorizedException)
    expect(sandboxes.verifyTokenPrincipal).not.toHaveBeenCalled()
  })

  it('rejects a token no sandbox recognizes — a user session is not a factory voice', async () => {
    const sandboxes = {
      verifyTokenPrincipal: vi.fn(async () => {
        throw new UnauthorizedException()
      }),
    }
    const guard = new OrchestratorSandboxGuard(sandboxes as unknown as SandboxesService)

    await expect(
      guard.canActivate(contextWith({ authorization: 'Bearer tok_stranger' }).context),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
