import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'
import { INBOX_KIND_STOP } from '@dltech/atlas-host'

import { startRig, type FaultRig, type ReadEvent } from '../../testing/fault-rig'
import {
  callIdOf,
  expectEpochsOrdered,
  isDoneResult,
  makeFifo,
  readEvents,
  waitForFile,
} from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const isInterruptedResult = (row: ReadEvent, callId: string): boolean =>
  row.type === 'tool-result' &&
  callIdOf(row) === callId &&
  (row.event as { interrupted?: boolean }).interrupted === true

const bashAlive = (marker: string): boolean => spawnSync('pgrep', ['-f', marker]).status === 0

const KILL_BOUND_MS = 8_000

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

    it('stop is consumed via the inbox; bash dies within reconnect backoff of the restore', async () => {
      const suffix = Math.random().toString(36).slice(2, 8)
      const sessionId = `fault-f20-${suffix}`
      const threadId = await rig.newSession({ sessionId, text: 'sleep then stop' })
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
      expect(bashAlive(gateFifo)).toBe(true)

      daemon.proxy.set({ refuse: true })
      const { inboxId } = await rig.plane.post({ sessionId, kind: INBOX_KIND_STOP, payload: '{}' })

      await new Promise((resolve) => setTimeout(resolve, 2_000))
      const duringOutage = await readEvents({ plane: rig.plane, threadId })
      expect(duringOutage.some((row) => row.type === 'tool-result' && callIdOf(row) === 'c1')).toBe(
        false,
      )
      expect(bashAlive(gateFifo)).toBe(true)

      daemon.proxy.clear()
      const restoredAt = Date.now()
      let killedAt = Number.POSITIVE_INFINITY
      while (Date.now() - restoredAt < KILL_BOUND_MS) {
        if (!bashAlive(gateFifo)) {
          killedAt = Date.now()
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      expect(killedAt - restoredAt).toBeLessThan(KILL_BOUND_MS)

      const events = await rig
        .waitForSeq({
          threadId,
          want: (rows) =>
            rows.some((row) => isInterruptedResult(row, 'c1')) &&
            rows.some(
              (row) =>
                row.type === 'input-consumed' &&
                (row.event as { inboxId?: number }).inboxId === inboxId,
            ),
          timeoutMs: 20_000,
        })
        .catch((error: unknown) => {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}\nhostA logs:\n${hostA.logs().join('\n')}`,
          )
        })
      expect(events.some((row) => callIdOf(row) === 'c1' && isDoneResult(row))).toBe(false)

      const settled = await readEvents({ plane: rig.plane, threadId })
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      const later = await readEvents({ plane: rig.plane, threadId })
      expect(later.length).toBe(settled.length)
      expect(later.filter((row) => isInterruptedResult(row, 'c1'))).toHaveLength(1)

      const runs = readFileSync(runsFile, 'utf8').trim().split('\n')
      expect(runs).toEqual(['run'])

      const lease = await rig.plane.currentLease({ sessionId })
      expect(await rig.labelOf(lease.lease.holderHostId)).toBe('host-a')
      expectEpochsOrdered({ events: later, finalEpoch: lease.lease.epoch })
    }, 60_000)
  },
)
