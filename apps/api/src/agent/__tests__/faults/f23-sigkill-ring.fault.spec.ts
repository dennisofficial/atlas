import { readFileSync } from 'node:fs'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig } from '../../testing/fault-rig'
import { callIdOf, isDoneResult, releaseFifo, waitForFile } from './fault-support'
import {
  holderScripts,
  prepareGated,
  waitForLog,
  waitUntil,
  watchersWaiting,
} from './lease-fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

describe.skipIf(REDIS_URL === undefined)(
  'F23 SIGKILL of the holder wakes its peer via the ring',
  () => {
    const testDb = useTestDatabase()
    let rig: FaultRig

    beforeAll(async () => {
      rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
    }, 60_000)

    afterAll(async () => {
      await rig.stop()
    })

    it('the peer holds within 5 s without a manual wake and the turn completes once', async () => {
      const sessionId = 'fault-f23-1'
      const gated = await prepareGated({ rig, sessionId })
      const threadId = await rig.newSession({ sessionId, text: 'one gated command' })

      const hostB = await rig.spawnHost({
        label: 'host-b',
        daemonUrl: gated.daemon.url,
        scripts: holderScripts({ gated, final: 'host b finished' }),
      })
      await rig.waitHeldBy({ sessionId, label: 'host-b', timeoutMs: 30_000 })
      await waitForFile({ path: gated.startedFile, timeoutMs: 30_000 })
      const before = await rig.plane.currentLease({ sessionId })
      const oldHostId = before.lease.holderHostId
      if (oldHostId === null) throw new Error('the session has no holder before the kill')

      const hostA = await rig.spawnHost({
        label: 'host-a',
        daemonUrl: gated.daemon.url,
        scripts: { [sessionId]: [{ text: 'host a finished' }] },
      })
      await waitForLog({ host: hostA, text: 'started hostId=', timeoutMs: 30_000 })
      await waitUntil({
        what: 'both watches to wait on each other',
        timeoutMs: 10_000,
        check: async () => (await watchersWaiting({ url: testDb().url })) === 2,
      })

      hostB.kill('SIGKILL')
      await hostB.exited
      await rig
        .waitHeldBy({ sessionId, label: 'host-a', timeoutMs: 5_000 })
        .catch((error: unknown) => {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}\nhost-a logs:\n${hostA.logs().join('\n')}`,
          )
        })

      const after = await rig.plane.currentLease({ sessionId })
      expect(after.lease.epoch).toBe(before.lease.epoch + 1)
      expect(await rig.labelOf(oldHostId)).toBeUndefined()

      await releaseFifo({ path: gated.gateFifo })
      const events = await rig.waitForSeq({
        threadId,
        want: (rows) =>
          rows.some((row) => callIdOf(row) === 'c1' && isDoneResult(row)) &&
          rows.some(
            (row) =>
              row.type === 'assistant-said' &&
              JSON.stringify(row.event).includes('host a finished'),
          ),
        timeoutMs: 30_000,
      })

      expect(
        events.filter((row) => row.type === 'tool-result' && callIdOf(row) === 'c1'),
      ).toHaveLength(1)
      expect(readFileSync(gated.runsFile, 'utf8').trim().split('\n')).toEqual(['run'])
    }, 90_000)
  },
)
