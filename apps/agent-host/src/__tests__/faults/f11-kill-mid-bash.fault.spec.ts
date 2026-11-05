import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig } from '../../testing/fault-rig'
import { callIdOf, isDoneResult, makeFifo, readEvents, waitForFile } from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

describe.skipIf(REDIS_URL === undefined)('F11 SIGKILL the holder mid bash', () => {
  const testDb = useTestDatabase()
  let rig: FaultRig

  beforeAll(async () => {
    rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
  }, 60_000)

  afterAll(async () => {
    await rig.stop()
  })

  it('bash survives the kill; the second host collects it exactly once', async () => {
    const sessionId = 'fault-f11-1'
    const threadId = await rig.newSession({ sessionId, text: 'sleep then echo' })
    const daemon = await rig.spawnDaemonFor({ sessionId })
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
            calls: [{ callId: 'c1', name: 'bash', input: { description: 'sleep', command: bash } }],
          },
          { text: 'host a finished' },
        ],
      },
    })
    await rig.claim({ sessionId, label: 'host-a' })
    await rig.waitForSeq({
      threadId,
      want: (rows) => rows.some((row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1'),
      timeoutMs: 20_000,
    })
    await waitForFile({ path: startedFile })

    const before = await readEvents({ plane: rig.plane, threadId })
    expect(before.some((row) => row.type === 'tool-result' && callIdOf(row) === 'c1')).toBe(false)

    hostA.kill('SIGKILL')
    await hostA.exited

    const hostB = await rig.spawnHost({
      label: 'host-b',
      daemonUrl: daemon.url,
      scripts: { [sessionId]: [{ text: 'host b finished' }] },
    })
    await rig.claim({ sessionId, label: 'host-b', timeoutMs: 20_000 })

    writeFileSync(gateFifo, 'go\n')

    const events = await rig
      .waitForSeq({
        threadId,
        want: (rows) => rows.some((row) => callIdOf(row) === 'c1' && isDoneResult(row)),
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
    expect(dispatches.map((row) => (row.event as { bootId?: string }).bootId)).toEqual([
      daemon.bootId,
    ])
    expect(results.length).toBe(1)
    expect(results.filter(isDoneResult).length).toBe(1)

    const runs = readFileSync(runsFile, 'utf8').trim().split('\n')
    expect(runs).toEqual(['run'])

    const lease = await rig.plane.currentLease({ sessionId })
    expect(await rig.labelOf(lease.lease.holderHostId)).toBe('host-b')
  }, 60_000)
})
