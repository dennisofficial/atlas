import { NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { sandboxByThread, USER_A, USER_B } from '../../../../test/session-seed'
import { prepareSandboxes, sandboxRow, THREAD, type StubClient } from './sandboxes.fixture'
import type { SandboxesService } from './sandboxes.service'
import { ESandboxState } from './sandboxes.types'
import { SandboxMissingError } from './vercel-sandbox.client'

describe('SandboxesService listing, status, stop and destroy', () => {
  let client: StubClient
  useTestDatabase()
  let service: SandboxesService

  beforeEach(async () => {
    ;({ client, service } = await prepareSandboxes())
  })

  it('list answers only the caller’s sandboxes, most recently active first', async () => {
    await sandboxRow({ threadId: 'brn_old', lastActivityAt: new Date('2026-09-01T00:00:00.000Z') })
    await sandboxRow({ threadId: THREAD, lastActivityAt: new Date('2026-09-16T00:00:00.000Z') })
    await sandboxRow({
      threadId: 'brn_other_user',
      userId: USER_B,
      lastActivityAt: new Date('2026-09-20T00:00:00.000Z'),
    })

    const listed = await service.list({ userId: USER_A })

    expect(listed.map((entry) => entry.threadId)).toEqual([THREAD, 'brn_old'])
  })

  it('reports the live state for the sidebar', async () => {
    await sandboxRow({ threadId: THREAD })
    client.inspect.mockResolvedValue({
      state: ESandboxState.Running,
      url: 'https://atlas-3000.vercel.run',
    })

    const status = await service.status({ userId: USER_A, threadId: THREAD })

    expect(status.state).toBe(ESandboxState.Running)
    expect(status.url).toBe('https://atlas-3000.vercel.run')
  })

  it('answers the stored state without a url when the sandbox is gone from Vercel', async () => {
    await sandboxRow({ threadId: THREAD, state: ESandboxState.Parked })
    client.inspect.mockRejectedValue(new SandboxMissingError('atlas-thread-brn_thread_1'))

    const status = await service.status({ userId: USER_A, threadId: THREAD })

    expect(status.state).toBe(ESandboxState.Parked)
    expect(status.url).toBeUndefined()
  })

  it('stops a sandbox and marks it parked, keeping the sealed token for the resume', async () => {
    await service.claim({ userId: USER_A, threadId: THREAD })

    await service.stop({ userId: USER_A, threadId: THREAD })

    const claimed = await sandboxByThread(THREAD)
    expect(client.stop).toHaveBeenCalledWith({ threadId: THREAD, name: claimed?.name })
    const row = await sandboxByThread(THREAD)
    expect(row?.state).toBe(ESandboxState.Parked)
    expect(row?.sealedToken).not.toBeNull()
  })

  it('notifies the sandbox before stopping it, with the operator-stop reason', async () => {
    await sandboxRow({ threadId: THREAD, name: 'atlas-thread-named' })

    await service.stop({ userId: USER_A, threadId: THREAD })

    expect(client.notifyParked).toHaveBeenCalledWith({
      threadId: THREAD,
      name: 'atlas-thread-named',
      reason: 'the sandbox was stopped',
    })
  })

  it('still stops the sandbox when the in-sandbox notify fails', async () => {
    await sandboxRow({ threadId: THREAD })
    client.notifyParked.mockRejectedValue(new Error('sandbox unreachable'))

    await service.stop({ userId: USER_A, threadId: THREAD })

    expect(client.stop).toHaveBeenCalled()
    const row = await sandboxByThread(THREAD)
    expect(row?.state).toBe(ESandboxState.Parked)
  })

  it('destroy deletes only the row; the harness owns the vercel side now', async () => {
    await sandboxRow({ threadId: THREAD })

    await service.destroy({ userId: USER_A, threadId: THREAD })

    expect(await db.orm.public.CloudSandbox.all()).toHaveLength(0)
    expect(client.stop).not.toHaveBeenCalled()
  })

  it('answers 404 destroying a sandbox owned by another user, leaving it in place', async () => {
    await sandboxRow({ threadId: THREAD, userId: USER_A })

    await expect(service.destroy({ userId: USER_B, threadId: THREAD })).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(await db.orm.public.CloudSandbox.all()).toHaveLength(1)
  })
})
