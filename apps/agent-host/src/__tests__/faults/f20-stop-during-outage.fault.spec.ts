import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'
import { INBOX_KIND_STOP } from '@dltech/atlas-host'

import { startRig, type FaultRig, type ReadEvent } from '../../testing/fault-rig'
import { callIdOf, isDoneResult, makeFifo, readEvents, waitForFile } from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const epochOf = (row: ReadEvent): number => (row.event as { epoch: number }).epoch

const isInterruptedResult = (row: ReadEvent): boolean => {
  if (row.type !== 'tool-result') return false
  return (row.event as { interrupted?: boolean }).interrupted === true
}

const bashAlive = (marker: string): boolean => {
  const selfSafe = spawnSync('pgrep', ['-f', marker])
  return selfSafe.status === 0
}

describe.skipIf(REDIS_URL === undefined)(
  'F20 stop pressed while the daemon link is dropped (F3 outage)',
  () => {
    const testDb = useTestDatabase()
    let rig: FaultRig

    beforeAll(async () => {
      rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
    }, 60_000)

    afterAll(async () => {
      await rig.stop()
    })

    it('stop lands via the inbox; bash is killed once the link returns; the turn ends', async () => {
      const sessionId = 'fault-f20-1'
      const threadId = await rig.newSession({ sessionId, text: 'sleep then stop' })
      const daemon = await rig.spawnDaemonFor({ sessionId })
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
      expect(bashAlive(gateFifo)).toBe(true)

      daemon.proxy.set({ refuse: true })
      await rig.plane.post({ sessionId, kind: INBOX_KIND_STOP, payload: '{}' })

      await new Promise((resolve) => setTimeout(resolve, 2_000))
      const duringOutage = await readEvents({ plane: rig.plane, threadId })
      expect(duringOutage.some((row) => row.type === 'tool-result' && callIdOf(row) === 'c1')).toBe(
        false,
      )
      expect(bashAlive(gateFifo)).toBe(true)

      daemon.proxy.clear()
      const stopped = await rig
        .waitForSeq({
          threadId,
          want: (rows) => rows.some((row) => callIdOf(row) === 'c1' && isInterruptedResult(row)),
          timeoutMs: 30_000,
        })
        .catch((error: unknown) => {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}\nhostA logs:\n${hostA.logs().join('\n')}`,
          )
        })
      expect(stopped.some((row) => callIdOf(row) === 'c1' && isDoneResult(row))).toBe(false)

      const deadline = Date.now() + 15_000
      while (bashAlive(gateFifo) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      expect(bashAlive(gateFifo)).toBe(false)

      const events = await readEvents({ plane: rig.plane, threadId })
      const dispatches = events.filter(
        (row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1',
      )
      const results = events.filter((row) => row.type === 'tool-result' && callIdOf(row) === 'c1')
      expect(dispatches.length).toBe(1)
      expect(results.length).toBe(1)
      expect(results.filter(isDoneResult).length).toBe(0)

      const runs = readFileSync(runsFile, 'utf8').trim().split('\n')
      expect(runs).toEqual(['run'])

      const lease = await rig.plane.currentLease({ sessionId })
      const epochs = events.map(epochOf)
      expect(Math.max(...epochs)).toBeLessThanOrEqual(lease.lease.epoch)
      const sorted = [...epochs].sort((a, b) => a - b)
      expect(epochs).toEqual(sorted)
    }, 60_000)
  },
)
