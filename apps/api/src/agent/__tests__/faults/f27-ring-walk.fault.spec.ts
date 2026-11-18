import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig, type HostProcess } from '../../testing/fault-rig'
import {
  hostIdsByLabel,
  prepareGated,
  sleep,
  textScripts,
  waitForLog,
  waitUntil,
  watchersWaiting,
} from './lease-fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const LABELS = ['host-b', 'host-c', 'host-d']

const SESSIONS = ['fault-f27-b', 'fault-f27-c', 'fault-f27-d'] as const

describe.skipIf(REDIS_URL === undefined)('F27 the ring walks over three consecutive deaths', () => {
  const testDb = useTestDatabase()
  let rig: FaultRig

  beforeAll(async () => {
    rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
  }, 60_000)

  afterAll(async () => {
    await rig.stop()
  })

  it('the survivor ends up holding every session and its watch has no waiter', async () => {
    const daemons = await Promise.all(
      SESSIONS.map(async (sessionId) => (await prepareGated({ rig, sessionId })).daemon),
    )
    const daemonUrls = Object.fromEntries(
      SESSIONS.map((sessionId, index) => [sessionId, daemons[index]?.url ?? '']),
    )
    const neverFile = join(daemons[0]?.home ?? '', 'never-created')
    const finals = textScripts({ sessionIds: SESSIONS, final: 'the survivor finished' })
    const stuck = Object.fromEntries(
      SESSIONS.map((sessionId) => [sessionId, [{ gateFile: neverFile, text: 'unreachable' }]]),
    )

    const hostA = await rig.spawnHost({
      label: 'host-a',
      daemonUrl: daemonUrls[SESSIONS[0]] ?? '',
      daemonUrls,
      scripts: finals,
    })
    await waitForLog({ host: hostA, text: 'started hostId=', timeoutMs: 30_000 })
    hostA.pause()
    const victims: HostProcess[] = []
    const threads: string[] = []
    for (const [index, sessionId] of SESSIONS.entries()) {
      const label = LABELS[index] ?? 'host-x'
      victims.push(
        await rig.spawnHost({
          label,
          daemonUrl: daemonUrls[sessionId] ?? '',
          daemonUrls,
          knobs: { maxSessions: 1 },
          scripts: stuck,
        }),
      )
      threads.push(await rig.newSession({ sessionId, text: 'a pending message' }))
      await rig.waitHeldBy({ sessionId, label, timeoutMs: 30_000 })
    }
    hostA.resume()
    await waitUntil({
      what: 'every host watch to wait on its successor',
      timeoutMs: 10_000,
      check: async () => (await watchersWaiting({ url: testDb().url })) === 4,
    })
    expect(Object.keys(await hostIdsByLabel({ url: testDb().url }))).toHaveLength(4)

    for (const victim of victims) {
      victim.kill('SIGKILL')
      await victim.exited
      await sleep(1_000)
    }

    for (const sessionId of SESSIONS) {
      await rig
        .waitHeldBy({ sessionId, label: 'host-a', timeoutMs: 15_000 })
        .catch((error: unknown) => {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}\nhost-a logs:\n${hostA.logs().join('\n')}`,
          )
        })
    }
    for (const threadId of threads) {
      await rig.waitForSeq({
        threadId,
        want: (rows) =>
          rows.some(
            (row) =>
              row.type === 'assistant-said' &&
              JSON.stringify(row.event).includes('the survivor finished'),
          ),
        timeoutMs: 30_000,
      })
    }

    await waitUntil({
      what: 'the dead hosts rows to be gone',
      timeoutMs: 10_000,
      check: async () =>
        Object.keys(await hostIdsByLabel({ url: testDb().url })).join() === 'host-a',
    })
    const survivorId = (await hostIdsByLabel({ url: testDb().url }))['host-a'] ?? -1
    await waitUntil({
      what: 'the watch of host-a to have no waiter',
      timeoutMs: 10_000,
      check: async () =>
        (await watchersWaiting({ url: testDb().url, ignoreWaitingOnHostId: survivorId })) === 0,
    })
    expect(await watchersWaiting({ url: testDb().url, ignoreWaitingOnHostId: survivorId })).toBe(0)
  }, 120_000)
})
