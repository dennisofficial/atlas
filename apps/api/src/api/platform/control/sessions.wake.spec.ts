import { describe, expect, it } from 'bun:test'
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

  it('refuses another user', async () => {
    const { service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    await expect(service.wake({ userId: 'user-b', sessionId: created.sessionId })).rejects.toThrow(
      'session not found',
    )
  })
})
