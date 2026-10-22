import { describe, expect, it, vi } from 'bun:test'
import type { ThreadLauncher } from '../../../_core/ports/thread-launcher'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import type { SandboxesService } from '../sandboxes/sandboxes.service'
import { ThreadsController } from './threads.controller'
import type { ThreadsHistoryService } from './threads-history.service'
import type { ThreadsService } from './threads.service'

const setup = () => {
  const create = vi.fn(async () => ({ id: 'brn_1' }))
  const launch = vi.fn(async () => ({ thread: { id: 'brn_1' }, provision: { state: 'booting' } }))
  const assertThreadInFamily = vi.fn(async () => undefined)
  const controller = new ThreadsController(
    { create } as unknown as ThreadsService,
    {} as ThreadsHistoryService,
    { assertThreadInFamily } as unknown as SandboxesService,
    { launch } as unknown as ThreadLauncher,
  )
  return { controller, create, launch, assertThreadInFamily }
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
