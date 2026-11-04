import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig, type ReadEvent } from '../../testing/fault-rig'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL
const testDb = useTestDatabase()

const isDoneResult = (row: ReadEvent): boolean => {
  if (row.type !== 'tool-result') return false
  const result = row.event as { output?: unknown; interrupted?: boolean }
  if (result.interrupted === true) return false
  if (typeof result.output !== 'object' || result.output === null) return false
  const output = result.output as { stdout?: unknown; exitCode?: unknown }
  return (
    output.exitCode === 0 && typeof output.stdout === 'string' && output.stdout.includes('done')
  )
}

describe.skipIf(REDIS_URL === undefined)('F11 SIGKILL the holder mid bash', () => {
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
    const runsFile = join(daemon.home, `runs-${sessionId}`)
    const bash = `echo run >> ${runsFile}; sleep 3; echo done`

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
    await rig.claim({ sessionId, holderId: 'host-a' })
    await rig.waitForSeq({
      threadId,
      want: (rows) => rows.some((row) => row.type === 'tool-dispatched'),
      timeoutMs: 20_000,
    })

    hostA.kill('SIGKILL')
    await hostA.exited

    const hostB = await rig.spawnHost({
      holderId: 'host-b',
      daemonUrl: daemon.url,
      scripts: { [sessionId]: [{ text: 'host b finished' }] },
    })
    await rig.claim({ sessionId, holderId: 'host-b', timeoutMs: 20_000 })

    const events = await rig
      .waitForSeq({
        threadId,
        want: (rows) => rows.some(isDoneResult),
        timeoutMs: 30_000,
      })
      .catch((error: unknown) => {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}\nhostB logs:\n${hostB.logs().join('\n')}`,
        )
      })

    const dispatches = events.filter((row) => row.type === 'tool-dispatched')
    const results = events.filter((row) => row.type === 'tool-result')
    expect(dispatches.length).toBe(1)
    expect(results.length).toBe(1)
    expect(results.filter(isDoneResult).length).toBe(1)

    const runs = readFileSync(runsFile, 'utf8').trim().split('\n')
    expect(runs).toEqual(['run'])

    const lease = await rig.plane.currentLease({ sessionId })
    expect(lease.lease.holderId).toBe('host-b')
  }, 60_000)
})
