import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig, type ReadEvent } from '../../testing/fault-rig'
import { callIdOf, isDoneResult, waitForFile } from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const epochOf = (row: ReadEvent): number => (row.event as { epoch: number }).epoch

describe.skipIf(REDIS_URL === undefined || process.env.ATLAS_FAULT_TESTS !== '1')(
  'F5 link flaps every 2 s for a minute (scaled to every 500 ms for 10 s)',
  () => {
    const testDb = useTestDatabase()
    let rig: FaultRig

    beforeAll(async () => {
      rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
    }, 60_000)

    afterAll(async () => {
      await rig.stop()
    })

    it('completes with one spawn per key and no doubled or missing output', async () => {
      const sessionId = 'fault-f05-1'
      const threadId = await rig.newSession({ sessionId, text: 'stream through flaps' })
      const daemon = await rig.spawnDaemonFor({ sessionId })
      const startedFile = join(daemon.home, `started-${sessionId}`)
      const runsFile = join(daemon.home, `runs-${sessionId}`)
      const bash = [
        `touch ${startedFile}`,
        `echo run >> ${runsFile}`,
        'for i in $(seq 1 60); do echo line-$i; sleep 0.2; done',
        'echo done',
      ].join('; ')

      const hostA = await rig.spawnHost({
        holderId: 'host-a',
        daemonUrl: daemon.url,
        scripts: {
          [sessionId]: [
            {
              calls: [
                { callId: 'c1', name: 'bash', input: { description: 'stream', command: bash } },
              ],
            },
            { text: 'host a finished' },
          ],
        },
      })
      await rig.claim({ sessionId, holderId: 'host-a' })
      await rig.waitForSeq({
        threadId,
        want: (rows) =>
          rows.some((row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1'),
        timeoutMs: 20_000,
      })
      await waitForFile({ path: startedFile })

      const flap = setInterval(() => daemon.proxy.drop(), 500)
      await new Promise((resolve) => setTimeout(resolve, 10_000))
      clearInterval(flap)

      const events = await rig
        .waitForSeq({
          threadId,
          want: (rows) =>
            rows.some((row) => callIdOf(row) === 'c1' && isDoneResult(row)) &&
            rows.some((row) => row.type === 'assistant-said'),
          timeoutMs: 40_000,
        })
        .catch((error: unknown) => {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}\nhostA logs:\n${hostA.logs().join('\n')}`,
          )
        })

      const dispatches = events.filter(
        (row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1',
      )
      const results = events.filter((row) => row.type === 'tool-result' && callIdOf(row) === 'c1')
      expect(dispatches.length).toBe(1)
      expect(results.length).toBe(1)

      const result = results[0]?.event as { output?: { stdout?: string } }
      const stdout = result.output?.stdout ?? ''
      const lines = stdout.split('\n')
      const expected = Array.from({ length: 60 }, (_, i) => `line-${i + 1}`)
      expect(lines.filter((line) => line.startsWith('line-'))).toEqual(expected)

      const runs = readFileSync(runsFile, 'utf8').trim().split('\n')
      expect(runs).toEqual(['run'])

      const lease = await rig.plane.currentLease({ sessionId })
      expect(lease.lease.holderId).toBe('host-a')
      const epochs = events.map(epochOf)
      expect(Math.max(...epochs)).toBeLessThanOrEqual(lease.lease.epoch)
      const sorted = [...epochs].sort((a, b) => a - b)
      expect(epochs).toEqual(sorted)
    }, 90_000)
  },
)
