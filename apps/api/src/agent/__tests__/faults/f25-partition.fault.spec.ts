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
  hostIdsByLabel,
  holderScripts,
  lateWritesAt,
  prepareGated,
  sleep,
  waitForLog,
  waitUntil,
  watchersWaiting,
} from './lease-fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

describe.skipIf(REDIS_URL === undefined)('F25 silent partition then edge drop', () => {
  const testDb = useTestDatabase()
  let rig: FaultRig

  beforeAll(async () => {
    rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
  }, 60_000)

  afterAll(async () => {
    await rig.stop()
  })

  it('nothing moves while the connections look alive; the drop hands the session to the peer within 5 s', async () => {
    const sessionId = 'fault-f25-1'
    const gated = await prepareGated({ rig, sessionId })
    const threadId = await rig.newSession({ sessionId, text: 'one gated command' })

    const hostB = await rig.spawnHost({
      label: 'host-b',
      daemonUrl: gated.daemon.url,
      dbProxy: 'own',
      knobs: { appendRetryMs: 30_000, queryTimeoutMs: 30_000 },
      scripts: holderScripts({ gated, final: 'host b finished' }),
    })
    const bDb = hostB.dbProxy
    if (bDb === undefined) throw new Error('the rig did not hand back a per-host db proxy')
    await rig.waitHeldBy({ sessionId, label: 'host-b', timeoutMs: 30_000 })
    await waitForFile({ path: gated.startedFile, timeoutMs: 30_000 })
    const before = await rig.plane.currentLease({ sessionId })
    const oldHostId = before.lease.holderHostId
    const hostA = await rig.spawnHost({
      label: 'host-a',
      daemonUrl: gated.daemon.url,
      scripts: { [sessionId]: [{ text: 'host a finished' }] },
    })
    await waitForLog({ host: hostA, text: 'started hostId=', timeoutMs: 30_000 })
    await waitUntil({
      what: 'the watches of both hosts to wait on each other',
      timeoutMs: 10_000,
      check: async () => (await watchersWaiting({ url: testDb().url })) === 2,
    })

    bDb.set({ blackhole: true })
    await releaseFifo({ path: gated.gateFifo })
    await sleep(3_000)
    const during = await rig.plane.currentLease({ sessionId })
    expect(during.live).toBe(true)
    expect(during.lease.holderHostId).toBe(oldHostId)
    expect(during.lease.epoch).toBe(before.lease.epoch)

    bDb.drop()
    await rig.waitHeldBy({ sessionId, label: 'host-a', timeoutMs: 5_000 })
    expect((await rig.plane.currentLease({ sessionId })).lease.epoch).toBe(before.lease.epoch + 1)

    bDb.clear()
    await rig.waitForSeq({
      threadId,
      want: (rows) =>
        rows.some(
          (row) =>
            row.type === 'assistant-said' && JSON.stringify(row.event).includes('host a finished'),
        ),
      timeoutMs: 30_000,
    })
    await waitUntil({
      what: 'host-b to re-register under a new id',
      timeoutMs: 20_000,
      check: async () => {
        const id = (await hostIdsByLabel({ url: testDb().url }))['host-b']
        return id !== undefined && id !== oldHostId
      },
    }).catch((error: unknown) => {
      throw new Error(`${String(error)}\nB:\n${hostB.logs().join('\n')}`)
    })
    await sleep(1_500)
    const events = await rig.waitForSeq({ threadId, want: () => true })

    expect(lateWritesAt({ events, epoch: before.lease.epoch })).toEqual([])
    expect(events.filter((row) => callIdOf(row) === 'c1' && isDoneResult(row))).toHaveLength(1)
    expectOneResultPerDispatch(events)
    expect(readFileSync(gated.runsFile, 'utf8').trim().split('\n')).toEqual(['run'])
  }, 90_000)
})
