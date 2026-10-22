import { GUARDS_METADATA } from '@nestjs/common/constants'
import { describe, expect, it, vi } from 'bun:test'
import { SANDBOX_REACHABLE_KEY } from '../../../_core/decorators/sandbox-reachable.decorator'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SessionOrSandboxGuard } from '../../platform/sessions/session-or-sandbox.guard'
import { UserFilesController } from './user-files.controller'
import type { UserFilesService } from './user-files.service'

function requestFor(userId: string): AuthenticatedRequest {
  return { auth: { userId } } as unknown as AuthenticatedRequest
}

function controllerWith(files: Partial<UserFilesService> = {}) {
  const controller = new UserFilesController(files as UserFilesService)
  return { controller }
}

describe('UserFilesController', () => {
  it('is sandbox-guarded and sandbox-reachable', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, UserFilesController) as unknown[]
    expect(guards).toContain(SessionOrSandboxGuard)
    expect(Reflect.getMetadata(SANDBOX_REACHABLE_KEY, UserFilesController)).toBe(true)
  })

  it('passes the authenticated user, never a client-supplied one, to the service', async () => {
    const list = vi.fn(async () => [])
    const { controller } = controllerWith({ list })

    await controller.handleList(requestFor('usr_a'), { tree: 'skills', sinceRevision: 3 })

    expect(list).toHaveBeenCalledWith({ userId: 'usr_a', tree: 'skills', sinceRevision: 3 })
  })

  it('joins a wildcard path array into a slash path', async () => {
    const put = vi.fn(async () => ({ revision: 1 }))
    const { controller } = controllerWith({ put })

    await controller.handlePut(requestFor('usr_a'), 'skills', ['review', 'SKILL.md'], {
      content: '',
      contentHash: 'h',
    })

    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'review/SKILL.md', baseRevision: 0 }),
    )
  })
})
