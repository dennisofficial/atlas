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
  laterScripts,
  prepareGated,
  terminateAllBackends,
  waitReheld,
  waitUntil,
  type GatedSession,
} from './lease-fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const FINAL = 'finished after the restart'

const scriptsFor = (args: { own: GatedSession; other: GatedSession }) => ({
  ...holderScripts({ gated: args.own, final: FINAL }),
  [args.other.sessionId]: [{ text: FINAL }],
  ...laterScripts({ sessionId: args.other.sessionId, final: FINAL }),
})

describe.skipIf(REDIS_URL === undefined)('F26 primary restart drops every connection', () => {
  const testDb = useTestDatabase()
  let rig: FaultRig

  beforeAll(async () => {
    rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
  }, 60_000)

  afterAll(async () => {
    await rig.stop()
  })

  it('both hosts re-register, both sessions are held again and each tool ran once', async () => {
    const one = await prepareGated({ rig, sessionId: 'fault-f26-1' })
    const two = await prepareGated({ rig, sessionId: 'fault-f26-2' })
    const daemonUrls = { [one.sessionId]: one.daemon.url, [two.sessionId]: two.daemon.url }

    const hostA = await rig.spawnHost({
      label: 'host-a',
      daemonUrl: one.daemon.url,
      daemonUrls,
      knobs: { maxSessions: 1 },
      scripts: scriptsFor({ own: one, other: two }),
    })
    const threadOne = await rig.newSession({ sessionId: one.sessionId, text: 'gated command' })
    await rig.waitHeldBy({ sessionId: one.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitForFile({ path: one.startedFile, timeoutMs: 30_000 })

    const hostB = await rig.spawnHost({
      label: 'host-b',
      daemonUrl: two.daemon.url,
      daemonUrls,
      scripts: scriptsFor({ own: two, other: one }),
    })
    const threadTwo = await rig.newSession({ sessionId: two.sessionId, text: 'gated command' })
    await rig.waitHeldBy({ sessionId: two.sessionId, label: 'host-b', timeoutMs: 30_000 })
    await waitForFile({ path: two.startedFile, timeoutMs: 30_000 })

    const idsBefore = await hostIdsByLabel({ url: testDb().url })
    const epochs = {
      [one.sessionId]: (await rig.plane.currentLease({ sessionId: one.sessionId })).lease.epoch,
      [two.sessionId]: (await rig.plane.currentLease({ sessionId: two.sessionId })).lease.epoch,
    }

    expect(await terminateAllBackends({ url: testDb().url })).toBeGreaterThan(2)

    await waitUntil({
      what: 'both hosts to re-register under new ids',
      timeoutMs: 30_000,
      check: async () => {
        const ids = await hostIdsByLabel({ url: testDb().url })
        return (
          ids['host-a'] !== undefined &&
          ids['host-b'] !== undefined &&
          ids['host-a'] !== idsBefore['host-a'] &&
          ids['host-b'] !== idsBefore['host-b']
        )
      },
    }).catch((error: unknown) => {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nA:\n${hostA.logs().join('\n')}\nB:\n${hostB.logs().join('\n')}`,
      )
    })
    for (const gated of [one, two]) {
      await waitReheld({
        rig,
        sessionId: gated.sessionId,
        afterEpoch: epochs[gated.sessionId] ?? 0,
        timeoutMs: 30_000,
      })
    }

    await releaseFifo({ path: one.gateFifo })
    await releaseFifo({ path: two.gateFifo })
    for (const [threadId, gated] of [
      [threadOne, one],
      [threadTwo, two],
    ] as const) {
      const events = await rig
        .waitForSeq({
          threadId,
          want: (rows) =>
            rows.some((row) => callIdOf(row) === 'c1' && isDoneResult(row)) &&
            rows.some(
              (row) => row.type === 'assistant-said' && JSON.stringify(row.event).includes(FINAL),
            ),
          timeoutMs: 40_000,
        })
        .catch((error: unknown) => {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}\nA:\n${hostA.logs().join('\n')}\nB:\n${hostB.logs().join('\n')}`,
          )
        })
      expect(
        events.filter((row) => row.type === 'tool-result' && callIdOf(row) === 'c1'),
      ).toHaveLength(1)
      expectOneResultPerDispatch(events)
      expect(readFileSync(gated.runsFile, 'utf8').trim().split('\n')).toEqual(['run'])
    }
  }, 120_000)
})
