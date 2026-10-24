import { BadRequestException } from '@nestjs/common'
import { describe, expect, it, vi } from 'bun:test'
import type { ThreadLauncher } from '../../../_core/ports/thread-launcher'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import type { SandboxesService } from '../sandboxes/sandboxes.service'
import { ThreadsController } from './threads.controller'
import type { ThreadArchiveService } from './thread-archive.service'
import type { ThreadsHistoryService } from './threads-history.service'
import type { ThreadsService } from './threads.service'

const setup = () => {
  const create = vi.fn(async () => ({ id: 'brn_1' }))
  const list = vi.fn(async () => [])
  const launch = vi.fn(async () => ({ thread: { id: 'brn_1' }, provision: { state: 'booting' } }))
  const assertThreadInFamily = vi.fn(async () => undefined)
  const setArchived = vi.fn(async () => undefined)
  const controller = new ThreadsController(
    { create, list } as unknown as ThreadsService,
    {} as ThreadsHistoryService,
    { assertThreadInFamily } as unknown as SandboxesService,
    { launch } as unknown as ThreadLauncher,
    { setArchived } as unknown as ThreadArchiveService,
  )
  return { controller, create, list, launch, assertThreadInFamily, setArchived }
}

const request = (extra: Partial<AuthenticatedRequest> = {}) =>
  ({
    auth: { userId: 'usr-1', sessionId: 's', email: 'a@b.c', activeOrganizationId: null },
    ...extra,
  }) as AuthenticatedRequest

const FIRST = { sendId: 'snd-1', text: 'hi' }

describe('ThreadsController.handleCreate', () => {
  it('refuses a firstMessage from a sandbox token before anything else runs', async () => {
    const { controller, launch, create, assertThreadInFamily } = setup()
    const sandbox = { sandboxId: 'sbx-1', threadId: 'thr-1' }

    await expect(
      controller.handleCreate(request({ sandbox }), {
        firstMessage: FIRST,
        agent: { spawnedBy: 'thr-1' },
      } as never),
    ).rejects.toMatchObject({ status: 403 })

    expect(assertThreadInFamily).not.toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('launches a user session create that carries a firstMessage', async () => {
    const { controller, launch } = setup()

    await controller.handleCreate(request(), { firstMessage: FIRST } as never)

    expect(launch).toHaveBeenCalledTimes(1)
  })
})

describe('ThreadsController.handleList', () => {
  it('lists by project', async () => {
    const { controller, list } = setup()

    await controller.handleList(request(), '/repo', undefined, undefined)

    expect(list).toHaveBeenCalledWith({ userId: 'usr-1', project: '/repo', limit: undefined })
  })

  it('lists by projectId', async () => {
    const { controller, list } = setup()

    await controller.handleList(request(), undefined, 'prj_1', '5')

    expect(list).toHaveBeenCalledWith({ userId: 'usr-1', projectId: 'prj_1', limit: 5 })
  })

  it('refuses neither project nor projectId', () => {
    const { controller, list } = setup()

    expect(() => controller.handleList(request(), undefined, undefined, undefined)).toThrow(
      BadRequestException,
    )
    expect(() => controller.handleList(request(), '', '', undefined)).toThrow(BadRequestException)
    expect(list).not.toHaveBeenCalled()
  })

  it('refuses both project and projectId', () => {
    const { controller, list } = setup()

    expect(() => controller.handleList(request(), '/repo', 'prj_1', undefined)).toThrow(
      BadRequestException,
    )
    expect(list).not.toHaveBeenCalled()
  })
})

describe('ThreadsController.handleArchive', () => {
  it('forwards the user, thread and archived flag', async () => {
    const { controller, setArchived } = setup()

    await controller.handleArchive(request(), 'thr-1', { archived: true })

    expect(setArchived).toHaveBeenCalledWith({
      userId: 'usr-1',
      threadId: 'thr-1',
      archived: true,
    })
  })
})
