import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig } from '../../testing/fault-rig'
import { EHostFault } from '../../testing/host-faults'
import { waitForLog, waitUntil } from './lease-fault-support'
import { echoScript, postMessage, REDIS_URL, waitAnswers } from './settle-fault-support'

describe.skipIf(REDIS_URL === undefined)('F28 turn fault out of the loop, host alive', () => {
  const testDb = useTestDatabase()
  let rig: FaultRig

  beforeAll(async () => {
    rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
  }, 60_000)

  afterAll(async () => {
    await rig.stop()
  })

  it('releases the lease, keeps the host and answers the next message', async () => {
    const sessionId = 'fault-f28-1'
    const threadId = await rig.newSession({ sessionId, text: 'first' })
    const daemon = await rig.spawnDaemonFor({ sessionId })
    const host = await rig.spawnHost({
      label: 'host-f28',
      daemonUrl: daemon.url,
      knobs: { fault: EHostFault.TurnThrowsOnce },
      scripts: { [sessionId]: echoScript({ replies: 3 }) },
    })

    await waitForLog({ host, text: 'fault: turn append throws', timeoutMs: 30_000 })
    const faultedEpoch = (await rig.plane.currentLease({ sessionId })).lease.epoch
    await waitUntil({
      what: 'the faulted lease to be released',
      timeoutMs: 10_000,
      check: async () => (await rig.plane.currentLease({ sessionId })).lease.epoch > faultedEpoch,
    })

    await waitAnswers({ rig, threadId, count: 1, host, timeoutMs: 20_000 })
    await postMessage({ rig, sessionId, text: 'second' })
    await waitAnswers({ rig, threadId, count: 2, host, timeoutMs: 20_000 })

    expect(host.logs().some((line) => line.includes('"host-fault"'))).toBe(true)
    const lease = await rig.plane.currentLease({ sessionId })
    expect(await rig.labelOf(lease.lease.holderHostId)).toBe('host-f28')
    const exited = await Promise.race([host.exited, Bun.sleep(200).then(() => 'alive')])
    expect(exited).toBe('alive')
  }, 90_000)
})
