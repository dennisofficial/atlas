import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig } from '../../testing/fault-rig'
import { expectOneResultPerDispatch } from './fault-support'
import { postMessage, REDIS_URL, waitAnswers } from './settle-fault-support'

const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

const waitReleased = async (args: {
  rig: FaultRig
  sessionId: string
  timeoutMs: number
}): Promise<void> => {
  const deadline = Date.now() + args.timeoutMs
  while (Date.now() < deadline) {
    const current = await args.rig.plane.currentLease({ sessionId: args.sessionId })
    if (current.lease.holderHostId === null) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`${args.sessionId} was never released`)
}

describe.skipIf(REDIS_URL === undefined)(
  'F46 a released lease leaves the pod running for the next host',
  () => {
    const testDb = useTestDatabase()
    let rig: FaultRig

    beforeAll(async () => {
      rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
    }, 60_000)

    afterAll(async () => {
      await rig.stop()
    })

    it('the next message is claimed by another host and runs once', async () => {
      const sessionId = `fault-f46-${RUN}`
      const threadId = await rig.newSession({ sessionId, text: 'first' })
      const daemon = await rig.spawnDaemonFor({ sessionId })
      const bootIdBefore = daemon.bootId
      const scripts = { [sessionId]: [{ text: 'first answer' }, { text: 'second answer' }] }

      const hostA = await rig.spawnHost({ label: 'host-a', daemonUrl: daemon.url, scripts })
      await waitAnswers({ rig, threadId, count: 1, host: hostA, timeoutMs: 30_000 })
      await waitReleased({ rig, sessionId, timeoutMs: 30_000 })

      hostA.kill('SIGKILL')
      await hostA.exited

      const hostB = await rig.spawnHost({ label: 'host-b', daemonUrl: daemon.url, scripts })
      await postMessage({ rig, sessionId, text: 'after the release' })
      await rig.waitHeldBy({ sessionId, label: 'host-b', timeoutMs: 30_000 })
      const events = await waitAnswers({ rig, threadId, count: 2, host: hostB, timeoutMs: 30_000 })

      expect(
        events.some(
          (row) =>
            row.type === 'assistant-said' && JSON.stringify(row.event).includes('second answer'),
        ),
      ).toBe(true)
      expectOneResultPerDispatch(events)
      expect(daemon.bootId).toBe(bootIdBefore)
    }, 120_000)
  },
)
