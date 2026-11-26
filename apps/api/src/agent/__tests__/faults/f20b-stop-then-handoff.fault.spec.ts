import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { EMessageOrigin } from '@dltech/atlas-core'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { INBOX_KIND_STOP } from '@dltech/atlas-host'
import { INBOX_KIND_MESSAGE } from '@dltech/atlas-protocol'

import { startRig, type FaultRig, type ReadEvent } from '../../testing/fault-rig'
import {
  callIdOf,
  expectLeaseSettled,
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
  'F20b stop pressed during an outage, then the holder is killed',
  () => {
    const testDb = useTestDatabase()
    let rig: FaultRig

    beforeAll(async () => {
      rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
    }, 60_000)

    afterAll(async () => {
      await rig.stop()
    })

    const stopDuringOutage = async (args: {
      label: string
      input: (paths: { started: string; gate: string; runs: string }) => Record<string, unknown>
    }): Promise<void> => {
      const first = `${args.label}-a`
      const second = `${args.label}-b`
      const suffix = Math.random().toString(36).slice(2, 8)
      const sessionId = `fault-f20b-${args.label}-${suffix}`
      const threadId = await rig.newSession({ sessionId, text: 'sleep then stop' })
      const daemon = await rig.spawnDaemonFor({ sessionId })
      const started = join(daemon.home, `started-${sessionId}`)
      const gate = join(daemon.home, `gate-${sessionId}`)
      const runs = join(daemon.home, `runs-${sessionId}`)
      makeFifo({ path: gate })
      const input = {
        description: 'gated',
        ...args.input({ started, gate, runs }),
      }

      const hostA = await rig.spawnHost({
        label: first,
        daemonUrl: daemon.url,
        scripts: {
          [sessionId]: [{ calls: [{ callId: 'c1', name: 'bash', input }] }, { text: 'a finished' }],
        },
      })
      await rig.claim({ sessionId, label: first, timeoutMs: 30_000 })
      await rig.waitForSeq({
        threadId,
        want: (rows) =>
          rows.some((row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1'),
        timeoutMs: 20_000,
      })
      await waitForFile({ path: started })
      expect(bashAlive(gate)).toBe(true)

      daemon.proxy.set({ refuse: true })
      await rig.plane.post({ sessionId, kind: INBOX_KIND_STOP, payload: '{}' })
      await rig.waitForSeq({
        threadId,
        want: (rows) => rows.some((row) => isInterruptedResult(row, 'c1')),
        timeoutMs: 20_000,
      })

      hostA.kill('SIGKILL')
      await hostA.exited
      await rig.plane.post({
        sessionId,
        kind: INBOX_KIND_MESSAGE,
        payload: JSON.stringify({ text: 'take over now', via: EMessageOrigin.Operator }),
      })

      const hostB = await rig.spawnHost({
        label: second,
        daemonUrl: daemon.url,
        scripts: { [sessionId]: [{ text: 'b finished' }] },
      })
      await rig.claim({ sessionId, label: second, timeoutMs: 30_000 })
      daemon.proxy.clear()
      const restoredAt = Date.now()

      let killedAt = Number.POSITIVE_INFINITY
      while (Date.now() - restoredAt < KILL_BOUND_MS) {
        if (!bashAlive(gate)) {
          killedAt = Date.now()
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      expect(
        killedAt - restoredAt < KILL_BOUND_MS
          ? 'bash died after the new holder took over'
          : `bash still ran ${KILL_BOUND_MS} ms after the link came back. hostB logs:\n${hostB.logs().join('\n')}`,
      ).toBe('bash died after the new holder took over')

      await new Promise((resolve) => setTimeout(resolve, 1_500))
      const later = await readEvents({ plane: rig.plane, threadId })
      expect(later.filter((row) => isInterruptedResult(row, 'c1'))).toHaveLength(1)
      expect(
        later.filter((row) => row.type === 'tool-result' && callIdOf(row) === 'c1'),
      ).toHaveLength(1)
      expect(later.some((row) => callIdOf(row) === 'c1' && isDoneResult(row))).toBe(false)
      expect(
        later.filter((row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1'),
      ).toHaveLength(1)

      expect(readFileSync(runs, 'utf8').trim().split('\n')).toEqual(['run'])
      await expectLeaseSettled({ rig, sessionId, holder: second })
      hostB.kill('SIGTERM')
      await hostB.exited
    }

    it('the holder that takes over cancels the stopped bash', async () => {
      await stopDuringOutage({
        label: 'plain',
        input: ({ started, gate, runs }) => ({
          command: `touch ${started}; echo run >> ${runs}; cat ${gate}; echo done`,
        }),
      })
    }, 90_000)

    it('the holder that takes over cancels the stopped bash that runs in a workdir', async () => {
      await stopDuringOutage({
        label: 'workdir',
        input: ({ started, gate, runs }) => ({
          command: `touch ${started}; echo run >> ${runs}; cat ${gate}; echo done`,
          workdir: '/tmp',
        }),
      })
    }, 90_000)
  },
)
