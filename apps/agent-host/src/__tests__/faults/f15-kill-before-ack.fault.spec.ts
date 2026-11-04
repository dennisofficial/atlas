import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'
import { scopeKeyOf } from '@dltech/atlas-host'

import { startRig, type FaultRig, type ReadEvent } from '../../testing/fault-rig'
import { callIdOf, isDoneResult, makeFifo, readEvents, waitForFile } from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const epochOf = (row: ReadEvent): number => (row.event as { epoch: number }).epoch

const expectEpochsOrdered = (events: readonly ReadEvent[], finalEpoch: number): void => {
  let previous = -1
  for (const row of events) {
    const epoch = epochOf(row)
    expect(epoch).toBeLessThanOrEqual(finalEpoch)
    expect(epoch).toBeGreaterThanOrEqual(previous)
    previous = epoch
  }
}

const journalOf = (args: { daemonHome: string; runId: string; callId: string }): string =>
  join(
    args.daemonHome,
    'daemon',
    'calls',
    `${scopeKeyOf({ runId: args.runId, callId: args.callId })}.0`,
    'state.json',
  )

describe.skipIf(REDIS_URL === undefined)(
  'F15 SIGKILL after the result is appended, before ack',
  () => {
    const testDb = useTestDatabase()
    let rig: FaultRig

    beforeAll(async () => {
      rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
    }, 60_000)

    afterAll(async () => {
      await rig.stop()
    })

    it('the new holder only acks; nothing reruns', async () => {
      const sessionId = 'fault-f15-1'
      const threadId = await rig.newSession({ sessionId, text: 'run then reply' })
      const daemon = await rig.spawnDaemonFor({ sessionId })
      const gateFifo = join(daemon.home, `gate-${sessionId}`)
      const runsFile = join(daemon.home, `runs-${sessionId}`)
      makeFifo({ path: gateFifo })
      const bash = `echo run >> ${runsFile}; cat ${gateFifo}; echo done`

      const hostA = await rig.spawnHost({
        holderId: 'host-a',
        daemonUrl: daemon.url,
        scripts: {
          [sessionId]: [
            {
              calls: [
                { callId: 'c1', name: 'bash', input: { description: 'run once', command: bash } },
              ],
            },
            { text: 'host a finished' },
          ],
        },
      })
      await rig.claim({ sessionId, holderId: 'host-a' })
      const dispatched = await rig.waitForSeq({
        threadId,
        want: (rows) =>
          rows.some((row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1'),
        timeoutMs: 20_000,
      })
      await waitForFile({ path: runsFile })

      daemon.proxy.set({ holdUpstream: true })
      writeFileSync(gateFifo, 'go\n')

      await rig.waitForSeq({
        threadId,
        want: (rows) => rows.some((row) => row.type === 'tool-result' && callIdOf(row) === 'c1'),
        timeoutMs: 20_000,
      })
      const before = await readEvents({ plane: rig.plane, threadId })
      expect(
        before.filter((row) => row.type === 'tool-result' && callIdOf(row) === 'c1').length,
      ).toBe(1)

      const dispatchedEvent = dispatched.find(
        (row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1',
      )?.event as { runId: string }
      const journal = journalOf({
        daemonHome: daemon.home,
        runId: dispatchedEvent.runId,
        callId: 'c1',
      })
      expect(existsSync(journal)).toBe(true)

      hostA.kill('SIGKILL')
      await hostA.exited
      daemon.proxy.clear()

      const hostB = await rig.spawnHost({
        holderId: 'host-b',
        daemonUrl: daemon.url,
        scripts: { [sessionId]: [{ text: 'host b finished' }] },
      })
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

      expect(existsSync(journal)).toBe(false)

      const dispatches = events.filter(
        (row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1',
      )
      const results = events.filter((row) => row.type === 'tool-result' && callIdOf(row) === 'c1')
      expect(dispatches.length).toBe(1)
      expect(results.length).toBe(1)
      expect(results.filter(isDoneResult).length).toBe(1)

      const runs = readFileSync(runsFile, 'utf8').trim().split('\n')
      expect(runs).toEqual(['run'])

      const lease = await rig.plane.currentLease({ sessionId })
      expect(lease.lease.holderId).toBe('host-b')
      expectEpochsOrdered(events, lease.lease.epoch)
    }, 60_000)
  },
)
