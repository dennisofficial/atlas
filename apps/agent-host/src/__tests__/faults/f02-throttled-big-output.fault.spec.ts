import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig, type ReadEvent } from '../../testing/fault-rig'
import { callIdOf, isDoneResult, waitForFile } from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const epochOf = (row: ReadEvent): number => (row.event as { epoch: number }).epoch

describe.skipIf(REDIS_URL === undefined || process.env.ATLAS_FAULT_TESTS !== '1')(
  'F2 64 KB/s bandwidth while a tool streams 5 MB of output (ping parked: the saturated downstream starves pongs, which F4 owns)',
  () => {
    const testDb = useTestDatabase()
    let rig: FaultRig

    beforeAll(async () => {
      rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
    }, 60_000)

    afterAll(async () => {
      await rig.stop()
    })

    it('completes; the streamed output is complete and in order', async () => {
      const sessionId = 'fault-f02-1'
      const threadId = await rig.newSession({ sessionId, text: 'stream 5 mb' })
      const daemon = await rig.spawnDaemonFor({ sessionId })
      daemon.proxy.set({ bytesPerSecond: 65_536 })
      const startedFile = join(daemon.home, `started-${sessionId}`)
      const runsFile = join(daemon.home, `runs-${sessionId}`)
      const payloadFile = join(daemon.home, `payload-${sessionId}`)
      const bash = [
        `touch ${startedFile}`,
        `echo run >> ${runsFile}`,
        `head -c 5000000 /dev/urandom | base64 -w0 > ${payloadFile}`,
        `cat ${payloadFile}`,
        'echo',
        `sha256sum ${payloadFile}`,
        'echo done',
      ].join('; ')

      const hostA = await rig.spawnHost({
        holderId: 'host-a',
        daemonUrl: daemon.url,
        knobs: { pingMs: 600_000 },
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
      await waitForFile({ path: startedFile })

      const events = await rig
        .waitForSeq({
          threadId,
          want: (rows) =>
            rows.some((row) => callIdOf(row) === 'c1' && isDoneResult(row)) &&
            rows.some((row) => row.type === 'assistant-said'),
          timeoutMs: 220_000,
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

      const result = results[0]?.event as {
        output?: { stdout?: string; truncated?: boolean; exitCode?: number }
      }
      const stdout = result.output?.stdout ?? ''
      expect(result.output?.truncated).toBe(true)
      expect(result.output?.exitCode).toBe(0)
      const hashMatch = /([0-9a-f]{64})\s+\S*payload-fault-f02-1/.exec(stdout)
      expect(hashMatch).not.toBeNull()
      const payload = readFileSync(payloadFile)
      const recomputed = createHash('sha256').update(payload).digest('hex')
      expect(hashMatch?.[1]).toBe(recomputed)

      const runs = readFileSync(runsFile, 'utf8').trim().split('\n')
      expect(runs).toEqual(['run'])

      const lease = await rig.plane.currentLease({ sessionId })
      expect(lease.lease.holderId).toBe('host-a')
      const epochs = events.map(epochOf)
      expect(Math.max(...epochs)).toBeLessThanOrEqual(lease.lease.epoch)
      const sorted = [...epochs].sort((a, b) => a - b)
      expect(epochs).toEqual(sorted)
    }, 260_000)
  },
)
