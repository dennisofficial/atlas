import { describe, expect, it, mock } from 'bun:test'
import type { PodOps } from '../../../agent'
import { setupSessionsService as setup } from './sessions.service.fixture'

const opsOf = () => {
  const hold = mock((_args: { sessionId: string }) => true)
  return { hold, ops: { hold } as unknown as PodOps }
}

describe('SessionsService.holdPod', () => {
  it('arms a pod hold for the owner', async () => {
    const { hold, ops } = opsOf()
    const { service } = setup({ ops })
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    expect(await service.holdPod({ userId: 'user-a', sessionId: created.sessionId })).toEqual({
      held: true,
    })
    expect(hold).toHaveBeenCalledWith({ sessionId: created.sessionId })
  })

  it('refuses another user before it reaches the pod', async () => {
    const { hold, ops } = opsOf()
    const { service } = setup({ ops })
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    await expect(
      service.holdPod({ userId: 'user-b', sessionId: created.sessionId }),
    ).rejects.toThrow('session not found')
    expect(hold).not.toHaveBeenCalled()
  })

  it('answers unheld when no host is running', async () => {
    const { service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    expect(await service.holdPod({ userId: 'user-a', sessionId: created.sessionId })).toEqual({
      held: false,
    })
  })
})
