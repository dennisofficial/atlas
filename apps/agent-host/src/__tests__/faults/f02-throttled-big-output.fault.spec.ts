import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig, type ReadEvent } from '../../testing/fault-rig'
import {
  callIdOf,
  expectEpochsOrdered,
  expectOneResultPerDispatch,
  waitForFile,
} from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const isOkResult = (row: ReadEvent, callId: string): boolean => {
  if (row.type !== 'tool-result' || callIdOf(row) !== callId) return false
  const result = row.event as { error?: unknown; interrupted?: boolean }
  return result.error === undefined && result.interrupted !== true
}

const sha256File = (path: string, length?: number): string => {
  const bytes = readFileSync(path)
  return createHash('sha256')
    .update(length === undefined ? bytes : bytes.subarray(0, length))
    .digest('hex')
}

describe.skipIf(REDIS_URL === undefined || process.env.ATLAS_FAULT_TESTS !== '1')(
  'F2 64 KB/s bandwidth while a tool streams 5 MB of output',
  () => {
    const testDb = useTestDatabase()
    let rig: FaultRig

    beforeAll(async () => {
      rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
    }, 60_000)

    afterAll(async () => {
      await rig.stop()
    })

    const runF2 = async (args: { pingMs?: number; assertNoReconnect?: boolean }): Promise<void> => {
      const suffix = Math.random().toString(36).slice(2, 8)
      const sessionId = `fault-f02-${suffix}`
      const threadId = await rig.newSession({ sessionId, text: 'stream 5 mb' })
      const daemon = await rig.spawnDaemonFor({ sessionId })
      daemon.proxy.set({ bytesPerSecond: 65_536 })
      const tapDir = mkdtempSync(join(tmpdir(), `atlas-fault-f02-tap-${suffix}-`))
      const tapFile = join(tapDir, 'tool-output.log')
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
        knobs: {
          toolOutputFile: tapFile,
          ...(args.pingMs === undefined ? {} : { pingMs: args.pingMs }),
        },
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
      try {
        await waitForFile({ path: startedFile })
        const acceptedBaseline = args.assertNoReconnect === true ? daemon.proxy.accepted() : 0

        const events = await rig
          .waitForSeq({
            threadId,
            want: (rows) =>
              rows.some((row) => isOkResult(row, 'c1')) &&
              rows.some((row) => row.type === 'assistant-said'),
            timeoutMs: 220_000,
          })
          .catch((error: unknown) => {
            throw new Error(
              `${error instanceof Error ? error.message : String(error)}\nhostA logs:\n${hostA.logs().join('\n')}`,
            )
          })

        expectOneResultPerDispatch(events)
        const result = events.find((row) => isOkResult(row, 'c1'))?.event as {
          output?: { truncated?: boolean; exitCode?: number }
        }
        expect(result.output?.truncated).toBe(true)
        expect(result.output?.exitCode).toBe(0)

        const payloadLength = readFileSync(payloadFile).length
        expect(sha256File(tapFile, payloadLength)).toBe(sha256File(payloadFile))

        const runs = readFileSync(runsFile, 'utf8').trim().split('\n')
        expect(runs).toEqual(['run'])
        if (args.assertNoReconnect === true) {
          expect(daemon.proxy.accepted()).toBe(acceptedBaseline)
        }

        const lease = await rig.plane.currentLease({ sessionId })
        expect(lease.lease.holderId).toBe('host-a')
        expectEpochsOrdered({ events, finalEpoch: lease.lease.epoch })
      } finally {
        hostA.kill('SIGKILL')
        await hostA.exited.catch(() => undefined)
      }
    }

    it('F2 throughput with pings parked (the saturated downstream starves pongs, which F4 owns)', async () => {
      await runF2({ pingMs: 600_000 })
    }, 260_000)

    it('F2 with default pings stays alive while output streams', async () => {
      await runF2({ assertNoReconnect: true })
    }, 260_000)
  },
)
