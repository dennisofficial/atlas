import { NotFoundException, StreamableFile, UnauthorizedException } from '@nestjs/common'
import type { ExecutionContext } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import type { SandboxAuthenticatedRequest } from './sandbox-token.guard'
import { SandboxTokenGuard } from './sandbox-token.guard'
import { SandboxContextController } from './sandbox-context.controller'
import type { SandboxesService } from './sandboxes.service'

const THREAD = 'brn_thread_1'

const requestFor = (threadId: string | undefined): SandboxAuthenticatedRequest =>
  ({
    params: threadId === undefined ? {} : { threadId },
    headers: {},
    sandbox: threadId === undefined ? undefined : { threadId, userId: 'user-a' },
  }) as unknown as SandboxAuthenticatedRequest

const controllerWith = (
  readTranscript: (args: { threadId: string }) => Promise<Buffer | null>,
): SandboxContextController =>
  new SandboxContextController({
    getContextArchive: vi.fn(async () => null),
    getTranscriptArchive: vi.fn(readTranscript),
  } as unknown as SandboxesService)

describe('SandboxContextController transcript', () => {
  it('streams the stored transcript archive', async () => {
    const archive = Buffer.from('tar-bytes')
    const controller = controllerWith(async () => archive)

    const result = await controller.handleGetTranscript(requestFor(THREAD))

    expect(result).toBeInstanceOf(StreamableFile)
  })

  it('404s when no transcript archive has landed', async () => {
    const controller = controllerWith(async () => null)

    await expect(controller.handleGetTranscript(requestFor(THREAD))).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('404s when the stored transcript archive is empty', async () => {
    const controller = controllerWith(async () => Buffer.alloc(0))

    await expect(controller.handleGetTranscript(requestFor(THREAD))).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('404s when the request carries no resolved sandbox', async () => {
    const controller = controllerWith(async () => Buffer.from('tar-bytes'))

    await expect(controller.handleGetTranscript(requestFor(undefined))).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })
})

describe('SandboxContextController guard', () => {
  const guardContext = (authorization?: string): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          params: { threadId: THREAD },
          headers: authorization === undefined ? {} : { authorization },
        }),
      }),
    }) as unknown as ExecutionContext

  it('rejects the route for a bearer token that does not match the thread', async () => {
    const guard = new SandboxTokenGuard({
      verifySessionToken: vi.fn(async () => {
        throw new UnauthorizedException('a valid sandbox session token is required')
      }),
    } as unknown as SandboxesService)

    await expect(guard.canActivate(guardContext('Bearer wrong-token'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
  })

  it('rejects the route carrying no bearer token at all', async () => {
    const guard = new SandboxTokenGuard({
      verifySessionToken: vi.fn(),
    } as unknown as SandboxesService)

    await expect(guard.canActivate(guardContext())).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('admits the route when the bearer token verifies against the thread', async () => {
    const verifySessionToken = vi.fn(async () => ({ userId: 'user-a' }))
    const guard = new SandboxTokenGuard({ verifySessionToken } as unknown as SandboxesService)

    const allowed = await guard.canActivate(guardContext('Bearer session-token'))

    expect(allowed).toBe(true)
    expect(verifySessionToken).toHaveBeenCalledWith({ threadId: THREAD, token: 'session-token' })
  })
})
