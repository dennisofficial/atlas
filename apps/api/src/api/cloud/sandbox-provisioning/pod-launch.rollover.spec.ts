import { NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { DISPATCH_FAILED_MESSAGE } from './pod-launch.service'
import { podProvisionIdempotencyKey } from './pod-provision.contract'
import {
  fakeDispatcher,
  podLaunchWith,
  seedProvisionedRow,
  seedThread,
} from './sandbox-provisioning.fixture'

describe('PodLaunchService.rollover', () => {
  useTestDatabase()

  it('claims the row and dispatches pod-provision with the session to stop', async () => {
    await seedThread()
    await seedProvisionedRow({ state: 'running', wakeClaim: new Date(0) })
    const { pod, dispatch } = podLaunchWith()

    const reply = await pod.rollover({ threadId: 'thr-1', sessionId: 'ses-old' })

    expect(reply).toEqual({ dispatched: true })
    const row = await db.orm.public.CloudSandbox.first({ sessionId: 'ses_thr-1' })
    const [job] = dispatch.mock.calls[0] ?? []
    expect(job?.payload).toEqual({
      threadId: 'thr-1',
      wakeClaim: row?.wakeClaim?.toISOString() ?? '',
      stopSessionId: 'ses-old',
    })
    expect(job?.idempotencyKey).toBe(podProvisionIdempotencyKey(job?.payload ?? never()))
  })

  it('dispatches once when two rollovers race and reports the loser as not dispatched', async () => {
    await seedThread()
    await seedProvisionedRow({ state: 'running', wakeClaim: new Date(0) })
    const { pod, dispatch } = podLaunchWith()

    const replies = await Promise.all([
      pod.rollover({ threadId: 'thr-1', sessionId: 'ses-old' }),
      pod.rollover({ threadId: 'thr-1', sessionId: 'ses-old' }),
    ])

    expect(replies.filter((reply) => reply.dispatched)).toHaveLength(1)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('rejects a thread without a pod row', async () => {
    await seedThread()
    const { pod } = podLaunchWith()
    await expect(pod.rollover({ threadId: 'thr-1', sessionId: 'ses-old' })).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('throws the dispatch failure when the job cannot be queued', async () => {
    await seedThread()
    await seedProvisionedRow({ state: 'running', wakeClaim: new Date(0) })
    const { pod } = podLaunchWith({
      dispatcher: fakeDispatcher({ failWith: new Error('trigger is down') }),
    })
    await expect(pod.rollover({ threadId: 'thr-1', sessionId: 'ses-old' })).rejects.toThrow(
      DISPATCH_FAILED_MESSAGE,
    )
  })
})

const never = (): never => {
  throw new Error('no dispatch recorded')
}
