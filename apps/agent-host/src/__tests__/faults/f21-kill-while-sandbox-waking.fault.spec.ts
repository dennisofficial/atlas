import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig } from '../../testing/fault-rig'
import {
  callIdOf,
  expectEpochsOrdered,
  expectOneResultPerDispatch,
  isDoneResult,
  readEvents,
} from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

describe.skipIf(REDIS_URL === undefined)(
  'F21 holder killed while the sandbox is still waking',
  () => {
    const testDb = useTestDatabase()
    let rig: FaultRig

    beforeAll(async () => {
      rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
    }, 60_000)

    afterAll(async () => {
      await rig.stop()
    })

    it('the new holder reuses the same daemon boot and runs the call exactly once', async () => {
      const sessionId = `fault-f21-1-${RUN}`
      const threadId = await rig.newSession({ sessionId, text: 'run one command' })
      const daemon = await rig.spawnDaemonFor({ sessionId })
      const bootId = daemon.bootId
      const runsFile = join(daemon.home, `runs-${sessionId}`)
      const bash = `echo run >> ${runsFile}; echo done`

      daemon.proxy.set({ refuse: true })
      const hostA = await rig.spawnHost({
        label: 'host-a',
        daemonUrl: daemon.url,
        scripts: {
          [sessionId]: [
            {
              calls: [
                { callId: 'c1', name: 'bash', input: { description: 'quick', command: bash } },
              ],
            },
            { text: 'host a finished' },
          ],
        },
      })
      await rig.claim({ sessionId, label: 'host-a', timeoutMs: 30_000 })

      await rig.waitForSeq({
        threadId,
        want: (rows) => rows.some((row) => row.type === 'tool-called' && callIdOf(row) === 'c1'),
        timeoutMs: 20_000,
      })
      expect(daemon.proxy.connections()).toBe(0)

      const refused = await readEvents({ plane: rig.plane, threadId })
      expect(refused.some((row) => row.type === 'tool-result' && callIdOf(row) === 'c1')).toBe(
        false,
      )

      const preKill = await rig.plane.currentLease({ sessionId })
      expect(await rig.labelOf(preKill.lease.holderHostId)).toBe('host-a')

      hostA.kill('SIGKILL')
      await hostA.exited
      daemon.proxy.clear()

      const hostB = await rig.spawnHost({
        label: 'host-b',
        daemonUrl: daemon.url,
        scripts: { [sessionId]: [{ text: 'host b finished' }] },
      })
      await rig.claim({ sessionId, label: 'host-b', timeoutMs: 30_000 })

      const events = await rig
        .waitForSeq({
          threadId,
          want: (rows) =>
            rows.some((row) => callIdOf(row) === 'c1' && isDoneResult(row)) &&
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

      expect(daemon.bootId).toBe(bootId)
      expect(
        events.filter((row) => row.type === 'tool-result' && callIdOf(row) === 'c1'),
      ).toHaveLength(1)
      expect(events.filter((row) => callIdOf(row) === 'c1' && isDoneResult(row))).toHaveLength(1)

      const runs = readFileSync(runsFile, 'utf8').trim().split('\n')
      expect(runs).toEqual(['run'])

      expectOneResultPerDispatch(events)

      const lease = await rig.plane.currentLease({ sessionId })
      expect(await rig.labelOf(lease.lease.holderHostId)).toBe('host-b')
      expect(lease.lease.epoch).toBeGreaterThan(preKill.lease.epoch)
      expectEpochsOrdered({ events, finalEpoch: lease.lease.epoch })
    }, 90_000)
  },
)
