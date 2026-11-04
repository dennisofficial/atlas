import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig } from '../../testing/fault-rig'
import { callIdOf, isDoneResult, readEvents } from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

describe.skipIf(REDIS_URL === undefined)('F13 SIGKILL between tool-dispatched and run', () => {
  const testDb = useTestDatabase()
  let rig: FaultRig

  beforeAll(async () => {
    rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
  }, 60_000)

  afterAll(async () => {
    await rig.stop()
  })

  it('the new holder runs the held call exactly once on the same bootId', async () => {
    const sessionId = 'fault-f13-1'
    const threadId = await rig.newSession({ sessionId, text: 'sleep' })
    const daemon = await rig.spawnDaemonFor({ sessionId })
    const runsFile = join(daemon.home, `runs-${sessionId}`)
    const bash = `echo run >> ${runsFile}; sleep 1; echo done`

    daemon.proxy.set({ latencyMs: 2_000 })
    const hostA = await rig.spawnHost({
      holderId: 'host-a',
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
    await rig.claim({ sessionId, holderId: 'host-a', timeoutMs: 30_000 })
    await rig
      .waitForSeq({
        threadId,
        want: (rows) =>
          rows.some((row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1'),
        timeoutMs: 30_000,
      })
      .catch((error: unknown) => {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}\nhostA logs:\n${hostA.logs().join('\n')}`,
        )
      })

    daemon.proxy.set({ holdUpstream: true })

    const before = await readEvents({ plane: rig.plane, threadId })
    expect(before.some((row) => row.type === 'tool-result' && callIdOf(row) === 'c1')).toBe(false)
    expect(existsSync(runsFile)).toBe(false)

    hostA.kill('SIGKILL')
    await hostA.exited
    daemon.proxy.drop()
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
    expect(lease.lease.holderId).toBe('host-b')
  }, 60_000)
})
