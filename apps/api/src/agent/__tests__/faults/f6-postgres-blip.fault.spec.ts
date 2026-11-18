import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig } from '../../testing/fault-rig'
import { callIdOf, isDoneResult, makeFifo, readEvents, waitForFile } from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

describe.skipIf(REDIS_URL === undefined)(
  'F6 Postgres unreachable for 10 s scaled to 1 s mid-turn',
  () => {
    const testDb = useTestDatabase()
    let rig: FaultRig

    beforeAll(async () => {
      rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
    }, 60_000)

    afterAll(async () => {
      await rig.stop()
    })

    it('retries appends inside the retry budget and completes on the same lease', async () => {
      const sessionId = 'fault-f6-1'
      const threadId = await rig.newSession({ sessionId, text: 'gated bash' })
      const daemon = await rig.spawnDaemonFor({ sessionId })
      const startedFile = join(daemon.home, `started-${sessionId}`)
      const gateFifo = join(daemon.home, `gate-${sessionId}`)
      const runsFile = join(daemon.home, `runs-${sessionId}`)
      makeFifo({ path: gateFifo })
      const bash = `touch ${startedFile}; echo run >> ${runsFile}; cat ${gateFifo}; echo done`

      const hostA = await rig.spawnHost({
        label: 'host-a',
        daemonUrl: daemon.url,
        scripts: {
          [sessionId]: [
            {
              calls: [
                { callId: 'c1', name: 'bash', input: { description: 'gated', command: bash } },
              ],
            },
            { text: 'host a finished' },
          ],
        },
      })
      await rig.claim({ sessionId, label: 'host-a' })
      await rig.waitForSeq({
        threadId,
        want: (rows) =>
          rows.some((row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1'),
        timeoutMs: 20_000,
      })
      await waitForFile({ path: startedFile })
      const leaseBefore = await rig.plane.currentLease({ sessionId })
      expect(await rig.labelOf(leaseBefore.lease.holderHostId)).toBe('host-a')

      rig.dbProxy.set({ refuse: true })
      writeFileSync(gateFifo, 'go\n')
      await sleep(600)

      const duringRefuse = await readEvents({ plane: rig.plane, threadId })
      expect(duringRefuse.some((row) => row.type === 'tool-result' && callIdOf(row) === 'c1')).toBe(
        false,
      )

      await sleep(400)
      rig.dbProxy.clear()

      const events = await rig
        .waitForSeq({
          threadId,
          want: (rows) =>
            rows.some(
              (row) =>
                row.type === 'assistant-said' &&
                JSON.stringify(row.event).includes('host a finished'),
            ),
          timeoutMs: 30_000,
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
      expect(results.filter(isDoneResult).length).toBe(1)

      const runs = readFileSync(runsFile, 'utf8').trim().split('\n')
      expect(runs).toEqual(['run'])

      const leaseAfter = await rig.plane.currentLease({ sessionId })
      expect(leaseAfter.live).toBe(true)
      expect(await rig.labelOf(leaseAfter.lease.holderHostId)).toBe('host-a')
      expect(leaseAfter.lease.epoch).toBe(leaseBefore.lease.epoch)

      const epochs = events.map((row) => (row.event as { epoch?: number }).epoch ?? 0)
      expect(Math.max(...epochs)).toBeLessThanOrEqual(leaseAfter.lease.epoch)
      const sorted = [...epochs].sort((a, b) => a - b)
      expect(epochs).toEqual(sorted)
    }, 60_000)
  },
)
