import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig } from '../../testing/fault-rig'
import { callIdOf, isDoneResult } from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

describe.skipIf(REDIS_URL === undefined)(
  'F18 sandbox stopped and resumed mid turn (new bootId)',
  () => {
    const testDb = useTestDatabase()
    let rig: FaultRig

    beforeAll(async () => {
      rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
    }, 60_000)

    afterAll(async () => {
      await rig.stop()
    })

    it('the holder sees the new bootId and the turn completes', async () => {
      const sessionId = 'fault-f18-1'
      const threadId = await rig.newSession({ sessionId, text: 'command then read' })
      const daemon = await rig.spawnDaemonFor({ sessionId })
      const bootId1 = daemon.bootId
      const payloadPath = join(daemon.home, `payload-${sessionId}.txt`)
      writeFileSync(payloadPath, 'RESUME-MARKER\n')
      const runsFile = join(daemon.home, `runs-${sessionId}`)
      const bash = `echo run >> ${runsFile}; echo done`

      const hostA = await rig.spawnHost({
        holderId: 'host-a',
        daemonUrl: daemon.url,
        scripts: {
          [sessionId]: [
            {
              calls: [
                { callId: 'c1', name: 'bash', input: { description: 'quick', command: bash } },
              ],
            },
            { calls: [{ callId: 'c2', name: 'read', input: { path: payloadPath } }] },
            { text: 'turn survived the sandbox restart' },
          ],
        },
      })
      await rig.claim({ sessionId, holderId: 'host-a', timeoutMs: 30_000 })

      await rig.waitForSeq({
        threadId,
        want: (rows) => rows.some((row) => callIdOf(row) === 'c1' && isDoneResult(row)),
        timeoutMs: 30_000,
      })

      await daemon.restart({ keepHome: true })
      const bootId2 = daemon.bootId
      expect(bootId2).not.toBe(bootId1)

      const events = await rig
        .waitForSeq({
          threadId,
          want: (rows) =>
            rows.some(
              (row) =>
                row.type === 'assistant-said' &&
                JSON.stringify(row.event).includes('turn survived the sandbox restart'),
            ) && rows.some((row) => row.type === 'tool-result' && callIdOf(row) === 'c2'),
          timeoutMs: 30_000,
        })
        .catch((error: unknown) => {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}\nhostA logs:\n${hostA.logs().join('\n')}`,
          )
        })

      expect(
        events.filter((row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1'),
      ).toHaveLength(1)
      expect(
        events.filter((row) => row.type === 'tool-result' && callIdOf(row) === 'c1'),
      ).toHaveLength(1)
      const c2Results = events.filter((row) => row.type === 'tool-result' && callIdOf(row) === 'c2')
      expect(c2Results).toHaveLength(1)
      expect(JSON.stringify(c2Results[0]?.event)).toContain('RESUME-MARKER')

      const runs = readFileSync(runsFile, 'utf8').trim().split('\n')
      expect(runs).toEqual(['run'])

      const lease = await rig.plane.currentLease({ sessionId })
      expect(lease.lease.holderId).toBe('host-a')
    }, 90_000)
  },
)
