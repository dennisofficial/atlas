import { describe, expect, it } from 'bun:test'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'

import { podResizeCancelHandlerOf } from './pod-resize-cancel-handler'

const NOW = '2026-11-03T12:00:00.000Z'

const setup = async () => {
  const store = new InMemoryControlStore({ clock: () => NOW })
  const plane = new ControlPlane({ store })
  await plane.createSession({
    sessionId: 's-1',
    userId: 'user-a',
    projectId: 'proj-a',
    mainThreadId: 't-1',
    sandboxProvider: 'vercel',
  })
  const handler = podResizeCancelHandlerOf({ plane })
  const cancel = () => handler({ plane, sessionId: 's-1', args: {} })
  return { plane, cancel }
}

const seedWaiting = async (plane: ControlPlane): Promise<number> => {
  const applied = await plane.recordPodDesired({ sessionId: 's-1', vcpus: 2, memoryGb: 4 })
  await plane.recordPodApplied({ sessionId: 's-1', vcpus: 2, memoryGb: 4, generation: applied })
  const waiting = await plane.recordPodDesired({ sessionId: 's-1', vcpus: 4, memoryGb: 8 })
  await plane.recordPodWaiting({ sessionId: 's-1', generation: waiting, since: NOW })
  return waiting
}

describe('podResizeCancelHandlerOf', () => {
  it('reverts a waiting resize to the applied shape', async () => {
    const { plane, cancel } = await setup()
    const waiting = await seedWaiting(plane)

    await cancel()

    const row = await plane.readSession({ sessionId: 's-1' })
    expect(row?.podWaitingSince).toBeNull()
    expect(row?.podSizeGeneration).toBe(waiting + 1)
    expect(row?.podAppliedGeneration).toBe(waiting + 1)
    expect(row?.podDesiredVcpus).toBe(2)
    expect(row?.podDesiredMemoryGb).toBe(4)
  })

  it('refuses when no resize waits for the pod to go idle', async () => {
    const { plane, cancel } = await setup()
    await plane.recordPodDesired({ sessionId: 's-1', vcpus: 4, memoryGb: 8 })

    await expect(cancel()).rejects.toBeInstanceOf(BadRequestException)
    await expect(cancel()).rejects.toThrow('No resize is waiting for the pod to go idle')
  })

  it('refuses a session that does not exist', async () => {
    const store = new InMemoryControlStore({ clock: () => NOW })
    const plane = new ControlPlane({ store })
    const handler = podResizeCancelHandlerOf({ plane })

    await expect(handler({ plane, sessionId: 'missing', args: {} })).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })
})
