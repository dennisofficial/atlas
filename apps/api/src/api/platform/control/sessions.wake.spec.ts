import { describe, expect, it, mock } from 'bun:test'
import { setupSessionsService as setup } from './sessions.service.fixture'

describe('SessionsService.wake', () => {
  it('asks the claim loop for a holder on a parked session', async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    expect(await service.wake({ userId: 'user-a', sessionId: created.sessionId })).toEqual({
      state: 'waking',
    })
    const { lease } = await plane.currentLease({ sessionId: created.sessionId })
    expect(lease.wantsHolder).toBe(true)
  })

  it('does nothing when a live holder is already elsewhere', async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    const revoke = mock(async () => true)
    plane.currentLease = (async () => ({
      lease: { sessionId: created.sessionId, epoch: 1, holderHostId: 7, wantsHolder: false },
      live: true,
    })) as unknown as typeof plane.currentLease
    plane.revoke = revoke as unknown as typeof plane.revoke

    expect(await service.wake({ userId: 'user-a', sessionId: created.sessionId })).toEqual({
      state: 'elsewhere',
    })
    expect(revoke).not.toHaveBeenCalled()
  })

  it('asks for a holder when the lease names a dead holder', async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    const revoke = mock(async () => true)
    plane.currentLease = (async () => ({
      lease: { sessionId: created.sessionId, epoch: 1, holderHostId: 7, wantsHolder: false },
      live: false,
    })) as unknown as typeof plane.currentLease
    plane.revoke = revoke as unknown as typeof plane.revoke

    expect(await service.wake({ userId: 'user-a', sessionId: created.sessionId })).toEqual({
      state: 'waking',
    })
    expect(revoke).toHaveBeenCalledWith({ sessionId: created.sessionId, wantsHolder: true })
  })

  it('refuses another user', async () => {
    const { service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    await expect(service.wake({ userId: 'user-b', sessionId: created.sessionId })).rejects.toThrow(
      'session not found',
    )
  })
})
