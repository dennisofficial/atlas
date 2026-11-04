import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig, type ReadEvent } from '../../testing/fault-rig'
import { callIdOf, isDoneResult, readEvents } from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const waitForCommittedResult = async (args: {
  rig: FaultRig
  threadId: string
  timeoutMs?: number
}): Promise<ReadEvent[]> => {
  const deadline = Date.now() + (args.timeoutMs ?? 15_000)
  for (;;) {
    const rows = await readEvents({ plane: args.rig.plane, threadId: args.threadId })
    if (rows.some((row) => row.type === 'tool-result' && callIdOf(row) === 'c1')) return rows
    if (Date.now() > deadline) throw new Error('the result append never committed')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

describe.skipIf(REDIS_URL === undefined)('F8 append commits but the reply is lost', () => {
  const testDb = useTestDatabase()
  let rig: FaultRig

  beforeAll(async () => {
    rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
  }, 60_000)

  afterAll(async () => {
    await rig.stop()
  })

  it('recognises the retried append as already committed and does not fork', async () => {
    const sessionId = 'fault-f8-1'
    const threadId = await rig.newSession({ sessionId, text: 'quick bash' })
    const daemon = await rig.spawnDaemonFor({ sessionId })
    const runsFile = join(daemon.home, `runs-${sessionId}`)
    const bash = `echo run >> ${runsFile}; echo done`

    const hostA = await rig.spawnHost({
      holderId: 'host-a',
      daemonUrl: daemon.url,
      knobs: { ttlMs: 5_000, fenceMs: 1_500 },
      scripts: {
        [sessionId]: [
          {
            calls: [{ callId: 'c1', name: 'bash', input: { description: 'quick', command: bash } }],
          },
          { text: 'host a finished' },
        ],
      },
    })
    await rig.claim({ sessionId, holderId: 'host-a' })
    await rig.waitForSeq({
      threadId,
      want: (rows) => rows.some((row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1'),
      timeoutMs: 20_000,
    })

    rig.dbProxy.set({ latencyMs: 800 })
    await waitForCommittedResult({ rig, threadId })
    rig.dbProxy.drop()
    rig.dbProxy.clear()

    const events = await rig
      .waitForSeq({
        threadId,
        want: (rows) =>
          rows.some(
            (row) =>
              row.type === 'assistant-said' &&
              JSON.stringify(row.event).includes('host a finished'),
          ),
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
    expect(dispatches.length).toBe(1)
    expect(results.length).toBe(1)
    expect(results.filter(isDoneResult).length).toBe(1)

    const runs = readFileSync(runsFile, 'utf8').trim().split('\n')
    expect(runs).toEqual(['run'])

    const corruption = hostA.logs().some((line) => line.includes('RecordCorrupt'))
    expect(corruption).toBe(false)

    const finalLease = await rig.plane.currentLease({ sessionId })
    expect(finalLease.lease.holderId).toBe('host-a')
    const epochs = events.map((row) => (row.event as { epoch?: number }).epoch ?? 0)
    expect(Math.max(...epochs)).toBeLessThanOrEqual(finalLease.lease.epoch)
    const sorted = [...epochs].sort((a, b) => a - b)
    expect(epochs).toEqual(sorted)
  }, 60_000)
})
