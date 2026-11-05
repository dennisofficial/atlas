import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig, type ReadEvent } from '../../testing/fault-rig'
import { callIdOf, isDoneResult, makeFifo, readEvents, waitForFile } from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const epochOf = (row: ReadEvent): number => (row.event as { epoch: number }).epoch

const expectRecordConsistent = (events: readonly ReadEvent[], finalEpoch: number): void => {
  const dispatched = events.filter((row) => row.type === 'tool-dispatched')
  for (const call of dispatched) {
    const results = events.filter(
      (row) => row.type === 'tool-result' && callIdOf(row) === callIdOf(call),
    )
    expect(results.length).toBe(1)
  }
  let previous = -1
  for (const row of events) {
    const epoch = epochOf(row)
    expect(epoch).toBeLessThanOrEqual(finalEpoch)
    expect(epoch).toBeGreaterThanOrEqual(previous)
    previous = epoch
  }
}

const waitForLog = async (args: {
  logs: () => string[]
  includes: string
  timeoutMs?: number
}): Promise<void> => {
  const deadline = Date.now() + (args.timeoutMs ?? 10_000)
  while (Date.now() < deadline) {
    if (args.logs().some((line) => line.includes(args.includes))) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`timed out waiting for log ${args.includes}`)
}

describe.skipIf(REDIS_URL === undefined)('F12 SIGTERM during a 5-minute bash', () => {
  const testDb = useTestDatabase()
  let rig: FaultRig

  beforeAll(async () => {
    rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
  }, 60_000)

  afterAll(async () => {
    await rig.stop()
  })

  it('hands off in about a second; the new holder collects the bash exactly once', async () => {
    const sessionId = 'fault-f12-1'
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
      knobs: { drainMs: 500 },
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

    const hostB = await rig.spawnHost({
      label: 'host-b',
      daemonUrl: daemon.url,
      scripts: { [sessionId]: [{ text: 'host b finished' }] },
    })
    await waitForLog({ logs: hostB.logs, includes: 'label=host-b' })

    const before = await readEvents({ plane: rig.plane, threadId })
    expect(before.some((row) => row.type === 'tool-result' && callIdOf(row) === 'c1')).toBe(false)
    const leaseBefore = await rig.plane.currentLease({ sessionId })
    const epochBefore = leaseBefore.lease.epoch

    hostA.kill('SIGTERM')
    await hostA.exited

    await rig.claim({ sessionId, label: 'host-b', timeoutMs: 20_000 })

    const leaseAfter = await rig.plane.currentLease({ sessionId })
    expect(leaseAfter.lease.epoch).toBeGreaterThan(epochBefore)

    writeFileSync(gateFifo, 'go\n')

    await rig
      .waitForSeq({
        threadId,
        want: (rows) =>
          rows.some((row) => callIdOf(row) === 'c1' && isDoneResult(row)) &&
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

    const events = await readEvents({ plane: rig.plane, threadId })
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
    expect(await rig.labelOf(lease.lease.holderHostId)).toBe('host-b')
    expectRecordConsistent(events, lease.lease.epoch)
  }, 60_000)
})
