import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig } from '../../testing/fault-rig'
import { EHostFault } from '../../testing/host-faults'
import { waitForLog, waitUntil } from './lease-fault-support'
import {
  echoScript,
  holderOf,
  IDLE_KNOBS,
  postMessage,
  REDIS_URL,
  waitAnswers,
} from './settle-fault-support'

const CASES = [
  { fault: EHostFault.RevokeThrowsTwice, marker: 'fault: revoke throws 2', boundMs: 5_000 },
  {
    fault: EHostFault.SandboxStopThrowsOnce,
    marker: 'fault: sandbox.stop throws',
    boundMs: 10_000,
  },
] as const

describe.skipIf(REDIS_URL === undefined)('F29 failed settle after an idle release', () => {
  const testDb = useTestDatabase()
  let rig: FaultRig

  beforeAll(async () => {
    rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
  }, 60_000)

  afterAll(async () => {
    await rig.stop()
  })

  for (const { fault, marker, boundMs } of CASES) {
    it(`${fault}: the release is retried and the next post is answered`, async () => {
      const sessionId = `fault-f29-${fault}`
      const threadId = await rig.newSession({ sessionId, text: 'first' })
      const daemon = await rig.spawnDaemonFor({ sessionId })
      const host = await rig.spawnHost({
        label: `host-f29-${fault}`,
        daemonUrl: daemon.url,
        knobs: { ...IDLE_KNOBS, fault },
        scripts: { [sessionId]: echoScript({ replies: 3 }) },
      })

      await waitAnswers({ rig, threadId, count: 1, host, timeoutMs: 30_000 })
      await waitForLog({ host, text: marker, timeoutMs: 30_000 })
      const failedAt = Date.now()
      await waitUntil({
        what: `${sessionId} to be released after the injected failure`,
        timeoutMs: boundMs,
        check: async () => (await holderOf({ rig, sessionId })) === null,
      })
      expect(Date.now() - failedAt).toBeLessThanOrEqual(boundMs)

      await postMessage({ rig, sessionId, text: 'second' })
      await waitAnswers({ rig, threadId, count: 2, host, timeoutMs: 20_000 })
      host.kill('SIGKILL')
      await host.exited
    }, 90_000)
  }
})
