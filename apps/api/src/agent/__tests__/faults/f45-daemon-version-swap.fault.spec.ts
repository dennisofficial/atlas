import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig } from '../../testing/fault-rig'
import {
  callIdOf,
  expectOneResultPerDispatch,
  isDoneResult,
  makeFifo,
  readEvents,
  waitForFile,
} from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

describe.skipIf(REDIS_URL === undefined)(
  'F45 a drained daemon hands its call to the next one',
  () => {
    const testDb = useTestDatabase()
    let rig: FaultRig

    beforeAll(async () => {
      rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
    }, 60_000)

    afterAll(async () => {
      await rig.stop()
    })

    it('finishes the running bash, exits on its own, and the next daemon serves the result', async () => {
      const sessionId = 'fault-f45-1'
      const threadId = await rig.newSession({ sessionId, text: 'drain during bash' })
      const daemon = await rig.spawnDaemonFor({ sessionId })
      const firstBoot = daemon.bootId
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
            { text: 'host a went on' },
          ],
        },
      })
      await rig.claim({ sessionId, label: 'host-a', timeoutMs: 30_000 })
      await rig.waitForSeq({
        threadId,
        want: (rows) =>
          rows.some((row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1'),
        timeoutMs: 30_000,
      })
      await waitForFile({ path: startedFile })

      const draining = daemon.drain({ deadlineMs: 60_000 })
      writeFileSync(gateFifo, 'go\n')
      await draining

      const orphans = spawnSync('pgrep', ['-f', daemon.home])
      expect(orphans.status).toBe(1)

      await daemon.restart({ keepHome: true })
      expect(daemon.bootId).not.toBe(firstBoot)

      const events = await rig
        .waitForSeq({
          threadId,
          want: (rows) => rows.some((row) => callIdOf(row) === 'c1' && isDoneResult(row)),
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
      expect(dispatches).toHaveLength(1)
      expect(dispatches.map((row) => (row.event as { bootId?: string }).bootId)).toEqual([
        firstBoot,
      ])
      expect(results).toHaveLength(1)
      expect(results.map((row) => (row.event as { interrupted?: boolean }).interrupted)).toEqual([
        undefined,
      ])
      expectOneResultPerDispatch(events)

      expect(readFileSync(runsFile, 'utf8').trim().split('\n')).toEqual(['run'])

      const mid = await readEvents({ plane: rig.plane, threadId })
      expect(
        mid.filter((row) => row.type === 'tool-result' && callIdOf(row) === 'c1'),
      ).toHaveLength(1)

      hostA.kill('SIGKILL')
      await hostA.exited
    }, 90_000)
  },
)
