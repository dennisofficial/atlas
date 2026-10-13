import { GUARDS_METADATA } from '@nestjs/common/constants'
import { ServiceUnavailableException, type MessageEvent } from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SANDBOX_REACHABLE_KEY } from '../../../_core/decorators/sandbox-reachable.decorator'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { SessionOrSandboxGuard } from '../../platform/sessions/session-or-sandbox.guard'
import { UserFilesController } from './user-files.controller'
import { UserFilesFanoutService } from './user-files.fanout'
import type { UserFilesService } from './user-files.service'
import { EUserFileEvent } from './user-files.types'

function requestFor(userId: string): AuthenticatedRequest {
  return { auth: { userId } } as unknown as AuthenticatedRequest
}

function controllerWith(files: Partial<UserFilesService> = {}) {
  const drain = new DrainStateService()
  const fanout = new UserFilesFanoutService(drain)
  const controller = new UserFilesController(files as UserFilesService, fanout, drain)
  return { controller, fanout, drain }
}

describe('UserFilesController', () => {
  afterEach(() => vi.useRealTimers())

  it('is sandbox-guarded and sandbox-reachable', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, UserFilesController) as unknown[]
    expect(guards).toContain(SessionOrSandboxGuard)
    expect(Reflect.getMetadata(SANDBOX_REACHABLE_KEY, UserFilesController)).toBe(true)
  })

  it('pushes a change frame to the owner stream and not to another user', () => {
    const { controller, fanout } = controllerWith()
    const mine: MessageEvent[] = []
    const theirs: MessageEvent[] = []
    const subA = controller.handleStream(requestFor('usr_a'), {}).subscribe((f) => mine.push(f))
    const subB = controller.handleStream(requestFor('usr_b'), {}).subscribe((f) => theirs.push(f))

    fanout.publish({
      userId: 'usr_a',
      change: { tree: 'skills', path: 'a.md', revision: 4 },
    })
    subA.unsubscribe()
    subB.unsubscribe()

    expect(mine).toEqual([
      {
        type: EUserFileEvent.Changed,
        data: { tree: 'skills', path: 'a.md', revision: 4 },
      },
    ])
    expect(theirs).toEqual([])
  })

  it('applies the optional tree filter', () => {
    const { controller, fanout } = controllerWith()
    const frames: MessageEvent[] = []
    const sub = controller
      .handleStream(requestFor('usr_a'), { tree: 'memory' })
      .subscribe((f) => frames.push(f))

    fanout.publish({ userId: 'usr_a', change: { tree: 'skills', path: 'a.md', revision: 1 } })
    sub.unsubscribe()

    expect(frames).toEqual([])
  })

  it('emits a heartbeat every 30 seconds and stops after unsubscribe', () => {
    vi.useFakeTimers()
    const { controller } = controllerWith()
    const frames: MessageEvent[] = []
    const sub = controller.handleStream(requestFor('usr_a'), {}).subscribe((f) => frames.push(f))

    vi.advanceTimersByTime(60_000)
    sub.unsubscribe()
    vi.advanceTimersByTime(60_000)

    expect(frames).toEqual([
      { type: EUserFileEvent.Heartbeat, data: {} },
      { type: EUserFileEvent.Heartbeat, data: {} },
    ])
  })

  it('refuses a stream once draining and completes open streams on drain', () => {
    const { controller, drain } = controllerWith()
    let completed = false
    controller
      .handleStream(requestFor('usr_a'), {})
      .subscribe({ complete: () => (completed = true) })

    drain.beginDrain()

    expect(completed).toBe(true)
    expect(() => controller.handleStream(requestFor('usr_a'), {})).toThrow(
      ServiceUnavailableException,
    )
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
