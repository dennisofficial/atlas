import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { JobDispatcher } from '../../../_core/ports/job-dispatcher'
import { seedThreadRow, seedUsers } from '../../../../test/session-seed'
import { PresenceService } from '../presence/presence.service'
import { NotificationsService } from './notifications.service'
import { PushLedger } from './push-ledger'

const TOKEN = 'ExponentPushToken[abc123]'

const registerDevice = async (userId: string, token: string) => {
  await db.orm.public.PushDevice.create({
    token,
    platform: 'ios',
    lastSeenAt: new Date('2026-11-03T00:00:00Z'),
    userId,
  })
}

describe('NotificationsService', () => {
  useTestDatabase()
  let dispatcher: { dispatch: ReturnType<typeof vi.fn> }
  let service: NotificationsService
  let watching: boolean
  let sentAt: number | undefined

  beforeEach(async () => {
    await seedUsers('usr-1')
    watching = false
    sentAt = undefined
    dispatcher = { dispatch: vi.fn(async () => ({ runId: 'run_1' })) }
    service = new NotificationsService(
      dispatcher as unknown as JobDispatcher,
      { isWatching: async () => watching } as unknown as PresenceService,
      {
        noteSent: async () => undefined,
        takeSent: async () => sentAt,
      } as unknown as PushLedger,
    )
  })

  it('dispatches one message per registered device', async () => {
    await registerDevice('usr-1', TOKEN)
    await service.notifyUser({
      userId: 'usr-1',
      title: 'T',
      body: 'B',
      data: { k: 'v' },
      idempotencyKey: 'k1',
    })
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1)
    expect(dispatcher.dispatch.mock.calls[0]?.[0]).toMatchObject({
      task: { id: 'push-send' },
      payload: { messages: [{ to: TOKEN, title: 'T', body: 'B', data: { k: 'v' } }] },
      idempotencyKey: 'k1',
    })
  })

  it('dispatches nothing when the user has no devices', async () => {
    await service.notifyUser({
      userId: 'usr-1',
      title: 'T',
      body: 'B',
      idempotencyKey: 'k1',
    })
    expect(dispatcher.dispatch).not.toHaveBeenCalled()
  })

  it('swallows a dispatch failure', async () => {
    await registerDevice('usr-1', TOKEN)
    dispatcher.dispatch.mockRejectedValue(new Error('trigger down'))
    await expect(
      service.notifyUser({ userId: 'usr-1', title: 'T', body: 'B', idempotencyKey: 'k1' }),
    ).resolves.toBeUndefined()
  })

  it('notifies on a main-thread turn end with the session title', async () => {
    await registerDevice('usr-1', TOKEN)
    await seedThreadRow({ id: 'thr-1', userId: 'usr-1', title: 'Fix the login bug' })
    await service.notifyTurnEnded({
      threadId: 'thr-1',
      outcome: 'completed',
      activityAt: '2026-11-03T01:02:03.000Z',
    })
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1)
    expect(dispatcher.dispatch.mock.calls[0]?.[0]).toMatchObject({
      payload: {
        messages: [
          {
            to: TOKEN,
            title: 'Fix the login bug',
            body: 'Finished',
            data: { threadId: 'thr-1', sessionId: 'ses_thr-1' },
            collapseId: 'thr-1',
            threadId: 'ses_thr-1',
          },
        ],
      },
      idempotencyKey: 'turn-ended:thr-1:2026-11-03T01:02:03.000Z',
    })
  })

  it('stays quiet while the thread is on screen in a desktop client', async () => {
    await registerDevice('usr-1', TOKEN)
    await seedThreadRow({ id: 'thr-1', userId: 'usr-1', title: 'Fix the login bug' })
    watching = true

    await service.notifyTurnEnded({
      threadId: 'thr-1',
      outcome: 'completed',
      activityAt: '2026-11-03T01:02:03.000Z',
    })

    expect(dispatcher.dispatch).not.toHaveBeenCalled()
  })

  it('asks iOS devices to drop the thread notification once it is read', async () => {
    await registerDevice('usr-1', TOKEN)
    sentAt = 1_760_000_000_000

    await service.dismissThread({ userId: 'usr-1', threadId: 'thr-1' })

    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1)
    expect(dispatcher.dispatch.mock.calls[0]?.[0]).toMatchObject({
      payload: {
        messages: [
          {
            to: TOKEN,
            contentAvailable: true,
            priority: 'normal',
            data: { dismissThreadId: 'thr-1' },
          },
        ],
      },
      idempotencyKey: 'push-dismiss:thr-1:1760000000000',
    })
  })

  it('dismisses nothing when no notification went out for the thread', async () => {
    await registerDevice('usr-1', TOKEN)

    await service.dismissThread({ userId: 'usr-1', threadId: 'thr-1' })

    expect(dispatcher.dispatch).not.toHaveBeenCalled()
  })

  it('falls back to Atlas as the title and names failures', async () => {
    await registerDevice('usr-1', TOKEN)
    await seedThreadRow({ id: 'thr-1', userId: 'usr-1' })
    await service.notifyTurnEnded({
      threadId: 'thr-1',
      outcome: 'failed',
      activityAt: '2026-11-03T01:02:03.000Z',
    })
    expect(dispatcher.dispatch.mock.calls[0]?.[0].payload.messages[0]).toMatchObject({
      title: 'Atlas',
      body: 'Failed — open Atlas to see why',
    })
  })

  it('never pushes for a sub-agent thread', async () => {
    await registerDevice('usr-1', TOKEN)
    await seedThreadRow({ id: 'thr-1', userId: 'usr-1' })
    const main = await db.orm.public.Thread.where({ id: 'thr-1' }).first()
    await db.orm.public.Thread.create({
      ...main!,
      id: 'thr-sub',
      spawnerThreadId: 'thr-1',
    })
    await service.notifyTurnEnded({
      threadId: 'thr-sub',
      outcome: 'completed',
      activityAt: '2026-11-03T01:02:03.000Z',
    })
    expect(dispatcher.dispatch).not.toHaveBeenCalled()
  })
})
