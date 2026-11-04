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

describe.skipIf(REDIS_URL === undefined)('F13 SIGKILL between tool-dispatched and run', () => {
  let rig: FaultRig

  beforeAll(async () => {
    rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
  }, 60_000)

  afterAll(async () => {
    await rig.stop()
  })

  it('the new holder runs the held call exactly once on the same bootId', async () => {
    const sessionId = 'fault-f13-1'
    const threadId = await rig.newSession({ sessionId, text: 'warm up, then sleep' })
    const daemon = await rig.spawnDaemonFor({ sessionId })
    const runsFile = join(daemon.home, `runs-${sessionId}`)
    const bash = `echo run >> ${runsFile}; sleep 1; echo done`

    const hostA = await rig.spawnHost({
      holderId: 'host-a',
      daemonUrl: daemon.url,
      scripts: {
        [sessionId]: [
          {
            calls: [
              {
                callId: 'c0',
                name: 'bash',
                input: { description: 'warm up', command: 'echo warm' },
              },
            ],
          },
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
      want: (rows) =>
        rows.filter((row) => row.type === 'tool-result').length >= 1 &&
        rows.some((row) => row.type === 'tool-called'),
      timeoutMs: 20_000,
    })

    daemon.proxy.set({ holdUpstream: true })
    await rig.waitForSeq({
      threadId,
      want: (rows) => rows.filter((row) => row.type === 'tool-dispatched').length >= 2,
      timeoutMs: 20_000,
    })

    hostA.kill('SIGKILL')
    await hostA.exited

    const hostB = await rig.spawnHost({
      holderId: 'host-b',
      daemonUrl: daemon.url,
      scripts: { [sessionId]: [{ text: 'host b finished' }] },
    })
    const claimed = rig.claim({ sessionId, holderId: 'host-b', timeoutMs: 20_000 })
    daemon.proxy.clear()
    await claimed

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

    const runs = readFileSync(runsFile, 'utf8').trim().split('\n')
    expect(runs).toEqual(['run'])

    const lease = await rig.plane.currentLease({ sessionId })
    expect(lease.lease.holderId).toBe('host-b')
  }, 60_000)
})
