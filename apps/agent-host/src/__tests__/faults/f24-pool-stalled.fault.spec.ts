import { readFileSync } from 'node:fs'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig } from '../../testing/fault-rig'
import {
  callIdOf,
  expectOneResultPerDispatch,
  isDoneResult,
  releaseFifo,
  waitForFile,
} from './fault-support'
import {
  holderScripts,
  lateWritesAt,
  prepareGated,
  sleep,
  waitForLog,
  waitUntil,
  watchersWaiting,
} from './lease-fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

describe.skipIf(REDIS_URL === undefined)('F24 stalled pool, healthy presence', () => {
  const testDb = useTestDatabase()
  let rig: FaultRig

  beforeAll(async () => {
    rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
  }, 60_000)

  afterAll(async () => {
    await rig.stop()
  })

  it('the holder ends only the stalled session after the append budget and the sweep hands it over', async () => {
    const sessionId = 'fault-f24-1'
    const gated = await prepareGated({ rig, sessionId })
    const threadId = await rig.newSession({ sessionId, text: 'one gated command' })

    const hostB = await rig.spawnHost({
      label: 'host-b',
      daemonUrl: gated.daemon.url,
      dbProxy: 'own',
      directPresence: true,
      knobs: { appendRetryMs: 2_500, queryTimeoutMs: 1_000, poolMax: 2 },
      scripts: holderScripts({ gated, final: 'host b finished' }),
    })
    const bDb = hostB.dbProxy
    if (bDb === undefined) throw new Error('the rig did not hand back a per-host db proxy')
    await rig.waitHeldBy({ sessionId, label: 'host-b', timeoutMs: 30_000 })
    await waitForFile({ path: gated.startedFile, timeoutMs: 30_000 })
    const before = await rig.plane.currentLease({ sessionId })

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

    bDb.set({ blackhole: true })
    await releaseFifo({ path: gated.gateFifo })
    await waitForLog({ host: hostB, text: 'append retry exhausted', timeoutMs: 30_000 })
    bDb.clear()
    await rig.waitHeldBy({ sessionId, label: 'host-a', timeoutMs: 45_000 })
    expect((await rig.plane.currentLease({ sessionId })).lease.epoch).toBe(before.lease.epoch + 1)

    await rig.waitForSeq({
      threadId,
      want: (rows) =>
        rows.some(
          (row) =>
            row.type === 'assistant-said' && JSON.stringify(row.event).includes('host a finished'),
        ),
      timeoutMs: 30_000,
    })
    await sleep(1_500)
    const events = await rig.waitForSeq({ threadId, want: () => true })

    expect(lateWritesAt({ events, epoch: before.lease.epoch })).toEqual([])
    expect(events.filter((row) => callIdOf(row) === 'c1' && isDoneResult(row))).toHaveLength(1)
    expectOneResultPerDispatch(events)
    expect(readFileSync(gated.runsFile, 'utf8').trim().split('\n')).toEqual(['run'])
  }, 90_000)
})
