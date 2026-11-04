import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig, type ReadEvent } from '../../testing/fault-rig'
import {
  callIdOf,
  expectEpochsOrdered,
  expectOneResultPerDispatch,
  makeFifo,
  releaseFifo,
  waitForFile,
} from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const isResult = (row: ReadEvent, callId: string): boolean =>
  row.type === 'tool-result' && callIdOf(row) === callId

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
      const suffix = Math.random().toString(36).slice(2, 8)
      const sessionId = `fault-f01-${suffix}`
      const threadId = await rig.newSession({ sessionId, text: 'two calls under latency' })
      const daemon = await rig.spawnDaemonFor({ sessionId })
      daemon.proxy.set({ latencyMs: 300, jitterMs: 200 })
      const startedFile = join(daemon.home, `started-${sessionId}`)
      const gateFifo = join(daemon.home, `gate-${sessionId}`)
      const runsFile = join(daemon.home, `runs-${sessionId}`)
      const runs2File = join(daemon.home, `runs2-${sessionId}`)
      makeFifo({ path: gateFifo })
      const bash = `touch ${startedFile}; echo run >> ${runsFile}; cat ${gateFifo}; echo done`
      const bash2 = `echo run >> ${runs2File}; echo second-done`

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
                { callId: 'c2', name: 'bash', input: { description: 'quick', command: bash2 } },
              ],
            },
            { text: 'host a finished' },
          ],
        },
      })
      await rig.claim({ sessionId, holderId: 'host-a' })
      await waitForFile({ path: startedFile })
      await releaseFifo({ path: gateFifo })

      const events = await rig
        .waitForSeq({
          threadId,
          want: (rows) =>
            rows.some((row) => isResult(row, 'c1')) &&
            rows.some((row) => isResult(row, 'c2')) &&
            rows.some((row) => row.type === 'assistant-said'),
          timeoutMs: 40_000,
        })
        .catch((error: unknown) => {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}\nhostA logs:\n${hostA.logs().join('\n')}`,
          )
        })

      expectOneResultPerDispatch(events)
      for (const callId of ['c1', 'c2']) {
        const result = events.find((row) => isResult(row, callId))?.event as {
          error?: unknown
          interrupted?: boolean
          output?: { stdout?: string; exitCode?: number }
        }
        expect(result.error).toBeUndefined()
        expect(result.interrupted).not.toBe(true)
        expect(result.output?.exitCode).toBe(0)
      }
      const c1 = events.find((row) => isResult(row, 'c1'))?.event as {
        output?: { stdout?: string }
      }
      const c2 = events.find((row) => isResult(row, 'c2'))?.event as {
        output?: { stdout?: string }
      }
      expect(c1.output?.stdout).toBe('go\ndone\n')
      expect(c2.output?.stdout).toBe('second-done\n')

      expect(readFileSync(runsFile, 'utf8').trim().split('\n')).toEqual(['run'])
      expect(readFileSync(runs2File, 'utf8').trim().split('\n')).toEqual(['run'])

      const lease = await rig.plane.currentLease({ sessionId })
      expect(lease.lease.holderId).toBe('host-a')
      expectEpochsOrdered({ events, finalEpoch: lease.lease.epoch })
    }, 60_000)
  },
)
