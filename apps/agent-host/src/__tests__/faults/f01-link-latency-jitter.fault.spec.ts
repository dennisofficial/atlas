import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig, type ReadEvent } from '../../testing/fault-rig'
import { callIdOf, isDoneResult, makeFifo, readEvents, waitForFile } from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const epochOf = (row: ReadEvent): number => (row.event as { epoch: number }).epoch

describe.skipIf(REDIS_URL === undefined || process.env.ATLAS_FAULT_TESTS !== '1')(
  'F1 300 ms latency ± 200 ms jitter on the daemon link for the whole session',
  () => {
    const testDb = useTestDatabase()
    let rig: FaultRig

    beforeAll(async () => {
      rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
    }, 60_000)

    afterAll(async () => {
      await rig.stop()
    })

    it('completes; no call fails; the session is only slower', async () => {
      const sessionId = 'fault-f01-1'
      const threadId = await rig.newSession({ sessionId, text: 'two calls under latency' })
      const daemon = await rig.spawnDaemonFor({ sessionId })
      daemon.proxy.set({ latencyMs: 300, jitterMs: 200 })
      const startedFile = join(daemon.home, `started-${sessionId}`)
      const gateFifo = join(daemon.home, `gate-${sessionId}`)
      const runsFile = join(daemon.home, `runs-${sessionId}`)
      makeFifo({ path: gateFifo })
      const bash = `touch ${startedFile}; echo run >> ${runsFile}; cat ${gateFifo}; echo done`

      const hostA = await rig.spawnHost({
        holderId: 'host-a',
        daemonUrl: daemon.url,
        scripts: {
          [sessionId]: [
            {
              calls: [
                { callId: 'c1', name: 'bash', input: { description: 'gated', command: bash } },
              ],
            },
            {
              calls: [
                {
                  callId: 'c2',
                  name: 'bash',
                  input: { description: 'quick', command: 'echo second-done' },
                },
              ],
            },
            { text: 'host a finished' },
          ],
        },
      })
      await rig.claim({ sessionId, holderId: 'host-a' })
      await waitForFile({ path: startedFile })
      writeFileSync(gateFifo, 'go\n')

      const events = await rig
        .waitForSeq({
          threadId,
          want: (rows) =>
            rows.some((row) => callIdOf(row) === 'c1' && isDoneResult(row)) &&
            rows.some(
              (row) =>
                row.type === 'tool-result' &&
                callIdOf(row) === 'c2' &&
                JSON.stringify(row.event).includes('second-done'),
            ) &&
            rows.some((row) => row.type === 'assistant-said'),
          timeoutMs: 40_000,
        })
        .catch((error: unknown) => {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}\nhostA logs:\n${hostA.logs().join('\n')}`,
          )
        })

      for (const callId of ['c1', 'c2']) {
        const dispatches = events.filter(
          (row) => row.type === 'tool-dispatched' && callIdOf(row) === callId,
        )
        const results = events.filter(
          (row) => row.type === 'tool-result' && callIdOf(row) === callId,
        )
        expect(dispatches.length).toBe(1)
        expect(results.length).toBe(1)
        const failure = results[0]?.event as { isError?: boolean; interrupted?: boolean }
        expect(failure.isError ?? false).toBe(false)
        expect(failure.interrupted ?? false).toBe(false)
      }

      const runs = readFileSync(runsFile, 'utf8').trim().split('\n')
      expect(runs).toEqual(['run'])

      const lease = await rig.plane.currentLease({ sessionId })
      expect(lease.lease.holderId).toBe('host-a')
      const epochs = events.map(epochOf)
      expect(Math.max(...epochs)).toBeLessThanOrEqual(lease.lease.epoch)
      const sorted = [...epochs].sort((a, b) => a - b)
      expect(epochs).toEqual(sorted)
    }, 60_000)
  },
)
