import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig, type HostProcess } from '../../testing/fault-rig'
import { callIdOf, waitForFile } from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const waitForLog = async (args: {
  host: HostProcess
  want: string
  timeoutMs?: number
}): Promise<void> => {
  const deadline = Date.now() + (args.timeoutMs ?? 10_000)
  while (Date.now() < deadline) {
    if (args.host.logs().some((line) => line.includes(args.want))) return
    await sleep(50)
  }
  throw new Error(`timed out waiting for ${args.host.holderId} to log ${args.want}`)
}

describe.skipIf(REDIS_URL === undefined)(
  'F7 Postgres unreachable for 45 s scaled to 4.5 s (self-fence 25 s scaled to 2.5 s)',
  () => {
    const testDb = useTestDatabase()
    let rig: FaultRig

    beforeAll(async () => {
      rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
    }, 60_000)

    afterAll(async () => {
      await rig.stop()
    })

    it('self-fences the old host and resumes on a new one without a double run', async () => {
      const sessionId = 'fault-f7-1'
      const threadId = await rig.newSession({ sessionId, text: 'slow bash' })
      const daemon = await rig.spawnDaemonFor({ sessionId })
      const startedFile = join(daemon.home, `started-${sessionId}`)
      const runsFile = join(daemon.home, `runs-${sessionId}`)
      const bash = `touch ${startedFile}; echo run >> ${runsFile}; sleep 30; echo done`

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
      const epochA = (await rig.plane.currentLease({ sessionId })).lease.epoch

      const refusedAt = Date.now()
      rig.dbProxy.set({ refuse: true })

      const hostB = await rig.spawnHost({
        holderId: 'host-b',
        daemonUrl: daemon.url,
        scripts: { [sessionId]: [{ text: 'host b finished' }] },
      })

      await waitForLog({ host: hostA, want: 'self-fenced' })
      hostA.kill('SIGKILL')
      await hostA.exited
      await sleep(Math.max(0, 4_500 - (Date.now() - refusedAt)))
      rig.dbProxy.clear()

      await rig.claim({ sessionId, holderId: 'host-b', timeoutMs: 20_000 })

      const events = await rig
        .waitForSeq({
          threadId,
          want: (rows) =>
            rows.some(
              (row) =>
                row.type === 'assistant-said' &&
                JSON.stringify(row.event).includes('host b finished'),
            ),
          timeoutMs: 30_000,
        })
        .catch((error: unknown) => {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}\nhostB logs:\n${hostB.logs().join('\n')}`,
          )
        })

      const dispatches = events.filter(
        (row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1',
      )
      const results = events.filter((row) => row.type === 'tool-result' && callIdOf(row) === 'c1')
      expect(dispatches.length).toBe(1)
      expect(results.length).toBe(1)

      const runs = readFileSync(runsFile, 'utf8').trim().split('\n')
      expect(runs).toEqual(['run'])

      const finalLease = await rig.plane.currentLease({ sessionId })
      expect(finalLease.lease.holderId).toBe('host-b')
      expect(finalLease.lease.epoch).toBe(epochA + 1)

      const epochs = events.map((row) => (row.event as { epoch?: number }).epoch ?? 0)
      expect(Math.max(...epochs)).toBeLessThanOrEqual(finalLease.lease.epoch)
      const sorted = [...epochs].sort((a, b) => a - b)
      expect(epochs).toEqual(sorted)
    }, 90_000)
  },
)
