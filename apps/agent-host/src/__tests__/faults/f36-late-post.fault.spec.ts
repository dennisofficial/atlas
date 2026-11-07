import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig } from '../../testing/fault-rig'
import { EHostFault } from '../../testing/host-faults'
import { waitForLog } from './lease-fault-support'
import {
  echoScript,
  IDLE_KNOBS,
  postMessage,
  REDIS_URL,
  waitAnswers,
  wakeCalls,
} from './settle-fault-support'

describe.skipIf(REDIS_URL === undefined)('F36 message posted as the idle release revokes', () => {
  const testDb = useTestDatabase()
  let rig: FaultRig

  beforeAll(async () => {
    rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
  }, 60_000)

  afterAll(async () => {
    await rig.stop()
  })

  it('answers the late message within a tick and never calls plane.wake', async () => {
    const sessionId = 'fault-f36-1'
    const threadId = await rig.newSession({ sessionId, text: 'first' })
    const daemon = await rig.spawnDaemonFor({ sessionId })
    const host = await rig.spawnHost({
      label: 'host-f36',
      daemonUrl: daemon.url,
      knobs: { ...IDLE_KNOBS, fault: EHostFault.PostDuringRevoke },
      scripts: { [sessionId]: echoScript({ replies: 3 }) },
    })

    await waitAnswers({ rig, threadId, count: 1, host, timeoutMs: 30_000 })
    await waitForLog({ host, text: 'fault: posted during revoke', timeoutMs: 30_000 })
    await waitAnswers({ rig, threadId, count: 2, host, timeoutMs: 15_000 })
    expect(wakeCalls(host)).toBe(0)

    await postMessage({ rig, sessionId, text: 'third' })
    await waitAnswers({ rig, threadId, count: 3, host, timeoutMs: 20_000 })
  }, 90_000)
})
