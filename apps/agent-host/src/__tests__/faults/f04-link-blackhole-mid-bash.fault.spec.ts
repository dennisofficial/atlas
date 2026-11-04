import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig, type ReadEvent } from '../../testing/fault-rig'
import {
  callIdOf,
  isDoneResult,
  makeFifo,
  readEvents,
  releaseFifo,
  waitForFile,
} from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const DETECT_WINDOW_MS = 4_000
const OUTAGE_MS = 2_000

const epochOf = (row: ReadEvent): number => (row.event as { epoch: number }).epoch

const waitForLinkClose = async (args: {
  closed(): boolean
  timeoutMs: number
}): Promise<number> => {
  const started = Date.now()
  const deadline = started + args.timeoutMs
  while (Date.now() < deadline) {
    if (args.closed()) return Date.now() - started
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`no link close observed within ${args.timeoutMs}ms`)
}

describe.skipIf(REDIS_URL === undefined)(
  'F4 daemon link black-holed mid-bash (40 s outage scaled to 2 s, 30 s detection scaled to 1.5 s, ping 10 s scaled to 500 ms)',
  () => {
    const testDb = useTestDatabase()
    let rig: FaultRig

    beforeAll(async () => {
      rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
    }, 60_000)

    afterAll(async () => {
      await rig.stop()
    })

    it('detects the dead link, reconnects and collects the result', async () => {
      const suffix = Math.random().toString(36).slice(2, 8)
      const sessionId = `fault-f04-${suffix}`
      const threadId = await rig.newSession({ sessionId, text: 'stream lines' })
      const daemon = await rig.spawnDaemonFor({ sessionId })
      const startedFile = join(daemon.home, `started-${sessionId}`)
      const gateFifo = join(daemon.home, `gate-${sessionId}`)
      const runsFile = join(daemon.home, `runs-${sessionId}`)
      makeFifo({ path: gateFifo })
      const bash = [
        `touch ${startedFile}`,
        `echo run >> ${runsFile}`,
        'for i in $(seq 1 30); do echo line-$i; sleep 0.1; done',
        `cat ${gateFifo}`,
        'echo done',
      ].join('; ')

      const hostA = await rig.spawnHost({
        holderId: 'host-a',
        daemonUrl: daemon.url,
        knobs: { pingMs: 500 },
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

      const before = await readEvents({ plane: rig.plane, threadId })
      expect(before.some((row) => row.type === 'tool-result' && callIdOf(row) === 'c1')).toBe(false)

      expect(daemon.proxy.connections()).toBeGreaterThan(0)
      const acceptedBefore = daemon.proxy.accepted()
      daemon.proxy.set({ blackhole: true })
      const detectedMs = await waitForLinkClose({
        closed: () => daemon.proxy.connections() === 0 || daemon.proxy.accepted() > acceptedBefore,
        timeoutMs: DETECT_WINDOW_MS,
      })
      expect(detectedMs).toBeLessThan(DETECT_WINDOW_MS)

      await new Promise((resolve) => setTimeout(resolve, Math.max(0, OUTAGE_MS - detectedMs)))
      daemon.proxy.clear()
      await releaseFifo({ path: gateFifo })

      const events = await rig
        .waitForSeq({
          threadId,
          want: (rows) =>
            rows.some((row) => callIdOf(row) === 'c1' && isDoneResult(row)) &&
            rows.some((row) => row.type === 'assistant-said'),
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

      const result = results[0]?.event as { output?: { stdout?: string } }
      const stdout = result.output?.stdout ?? ''
      const lines = stdout.split('\n')
      const expected = Array.from({ length: 30 }, (_, i) => `line-${i + 1}`)
      expect(lines.filter((line) => line.startsWith('line-'))).toEqual(expected)

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
