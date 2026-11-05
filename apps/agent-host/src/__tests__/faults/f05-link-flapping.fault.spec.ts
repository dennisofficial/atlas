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
  waitForFile,
} from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

describe.skipIf(REDIS_URL === undefined || process.env.ATLAS_FAULT_TESTS !== '1')(
  'F5 link flaps every 2 s for a minute (scaled to every 500 ms for 10 s)',
  () => {
    const testDb = useTestDatabase()
    let rig: FaultRig

    beforeAll(async () => {
      rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
    }, 60_000)

    afterAll(async () => {
      await rig.stop()
    })

    it('reconnects through the flaps and completes with one spawn per key', async () => {
      const suffix = Math.random().toString(36).slice(2, 8)
      const sessionId = `fault-f05-${suffix}`
      const threadId = await rig.newSession({ sessionId, text: 'stream through flaps' })
      const daemon = await rig.spawnDaemonFor({ sessionId })
      const startedFile = join(daemon.home, `started-${sessionId}`)
      const runsFile = join(daemon.home, `runs-${sessionId}`)
      const bash = [
        `touch ${startedFile}`,
        `echo run >> ${runsFile}`,
        'for i in $(seq 1 60); do echo line-$i; sleep 0.2; done',
        'echo done',
      ].join('; ')

      const hostA = await rig.spawnHost({
        label: 'host-a',
        daemonUrl: daemon.url,
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
      await rig.claim({ sessionId, label: 'host-a' })
      await rig.waitForSeq({
        threadId,
        want: (rows) =>
          rows.some((row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1'),
        timeoutMs: 20_000,
      })
      await waitForFile({ path: startedFile })

      let reconnects = 0
      let sampling = true
      let previous = daemon.proxy.connections()
      const sampler = (async () => {
        while (sampling) {
          const current = daemon.proxy.connections()
          if (previous === 0 && current > 0) reconnects += 1
          previous = current
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
      })()
      const flapping = Date.now()
      while (Date.now() - flapping < 10_000) {
        daemon.proxy.drop()
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      sampling = false
      await sampler
      const pending = await rig.plane.readEvents({
        threadId,
        afterSeq: 0,
        limit: 1_000,
        visible: true,
      })
      expect(
        pending.events.some(
          (row) => row.type === 'tool-result' && (row as { callId?: string }).callId === 'c1',
        ),
      ).toBe(false)
      expect(reconnects).toBeGreaterThanOrEqual(3)

      const events = await rig
        .waitForSeq({
          threadId,
          want: (rows) =>
            rows.some((row) => callIdOf(row) === 'c1' && isDoneResult(row)) &&
            rows.some((row) => row.type === 'assistant-said'),
          timeoutMs: 40_000,
        })
        .catch((error: unknown) => {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}\nhostA logs:\n${hostA.logs().join('\n')}`,
          )
        })

      expectOneResultPerDispatch(events)
      const result = events.find((row) => callIdOf(row) === 'c1' && isDoneResult(row))?.event as {
        output?: { stdout?: string }
      }
      const stdout = result.output?.stdout ?? ''
      const lines = stdout.split('\n')
      const expected = Array.from({ length: 60 }, (_, i) => `line-${i + 1}`)
      expect(lines.filter((line) => line.startsWith('line-'))).toEqual(expected)

      const runs = readFileSync(runsFile, 'utf8').trim().split('\n')
      expect(runs).toEqual(['run'])

      const lease = await rig.plane.currentLease({ sessionId })
      expect(await rig.labelOf(lease.lease.holderHostId)).toBe('host-a')
      expectEpochsOrdered({ events, finalEpoch: lease.lease.epoch })
    }, 90_000)
  },
)
