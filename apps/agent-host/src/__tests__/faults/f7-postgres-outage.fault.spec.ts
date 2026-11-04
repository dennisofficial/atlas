import { closeSync, constants, openSync, readFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig, type HostProcess, type ReadEvent } from '../../testing/fault-rig'
import { callIdOf, isDoneResult, makeFifo, waitForFile } from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const waitForFence = async (args: { host: HostProcess; timeoutMs?: number }): Promise<number> => {
  const deadline = Date.now() + (args.timeoutMs ?? 10_000)
  while (Date.now() < deadline) {
    if (args.host.logs().some((line) => line.includes('self-fenced'))) return Date.now()
    await sleep(25)
  }
  throw new Error(`timed out waiting for ${args.host.holderId} to self-fence`)
}

const releaseFifo = (path: string): boolean => {
  try {
    const fd = openSync(path, constants.O_WRONLY | constants.O_NONBLOCK)
    writeSync(fd, 'go\n')
    closeSync(fd)
    return true
  } catch {
    return false
  }
}

type Scenario = {
  events: ReadEvent[]
  released: boolean
  fencedAt: number
  renewedAtMs: number
  epochA: number
  runsFile: string
}

const runOutage = async (args: { rig: FaultRig; sessionId: string }): Promise<Scenario> => {
  const { rig, sessionId } = args
  const threadId = await rig.newSession({ sessionId, text: 'gated bash' })
  const daemon = await rig.spawnDaemonFor({ sessionId })
  const startedFile = join(daemon.home, `started-${sessionId}`)
  const gateFifo = join(daemon.home, `gate-${sessionId}`)
  const runsFile = join(daemon.home, `runs-${sessionId}`)
  makeFifo({ path: gateFifo })
  const bash = `touch ${startedFile}; echo run >> ${runsFile}; cat ${gateFifo}; echo done`

  const hostA = await rig.spawnHost({
    holderId: 'host-a',
    daemonUrl: daemon.url,
    dbProxy: 'own',
    scripts: {
      [sessionId]: [
        {
          calls: [{ callId: 'c1', name: 'bash', input: { description: 'gated', command: bash } }],
        },
        { text: 'host a finished' },
      ],
    },
  })
  const aDb = hostA.dbProxy
  if (aDb === undefined) throw new Error('the rig did not hand back a per-host db proxy')

  await rig.claim({ sessionId, holderId: 'host-a' })
  await rig.waitForSeq({
    threadId,
    want: (rows) => rows.some((row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1'),
    timeoutMs: 20_000,
  })
  await waitForFile({ path: startedFile })
  const leaseA = await rig.plane.currentLease({ sessionId })
  expect(leaseA.lease.holderId).toBe('host-a')
  const epochA = leaseA.lease.epoch
  const renewedAtMs = Date.parse(leaseA.lease.renewedAt)

  aDb.set({ refuse: true })

  const hostB = await rig.spawnHost({
    holderId: 'host-b',
    daemonUrl: daemon.url,
    scripts: { [sessionId]: [{ text: 'host b finished' }] },
  })

  const fencedAt = await waitForFence({ host: hostA })
  await rig.claim({ sessionId, holderId: 'host-b', timeoutMs: 20_000 })

  aDb.clear()
  const released = releaseFifo(gateFifo)

  const events = await rig
    .waitForSeq({
      threadId,
      want: (rows) =>
        rows.some(
          (row) =>
            row.type === 'assistant-said' && JSON.stringify(row.event).includes('host b finished'),
        ),
      timeoutMs: 30_000,
    })
    .catch((error: unknown) => {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nhostB logs:\n${hostB.logs().join('\n')}`,
      )
    })

  return { events, released, fencedAt, renewedAtMs, epochA, runsFile }
}

describe.skipIf(REDIS_URL === undefined)(
  'F7 Postgres unreachable for 45 s scaled (self-fence 25 s scaled to 2.5 s)',
  () => {
    const testDb = useTestDatabase()
    let rig: FaultRig

    beforeAll(async () => {
      rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
    }, 60_000)

    afterAll(async () => {
      await rig.stop()
    })

    it('fences within the scaled deadline and resumes on a new host without a double run', async () => {
      const scenario = await runOutage({ rig, sessionId: 'fault-f7-1' })

      const fenceDeadlineMs = scenario.renewedAtMs + (3_000 - 1_000 + 500)
      expect(scenario.fencedAt).toBeGreaterThanOrEqual(scenario.renewedAtMs + 2_000 - 500)
      expect(scenario.fencedAt).toBeLessThanOrEqual(fenceDeadlineMs + 1_000)

      const dispatches = scenario.events.filter(
        (row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1',
      )
      const results = scenario.events.filter(
        (row) => row.type === 'tool-result' && callIdOf(row) === 'c1',
      )
      expect(dispatches.length).toBe(1)
      expect(results.length).toBe(1)

      const runs = readFileSync(scenario.runsFile, 'utf8').trim().split('\n')
      expect(runs).toEqual(['run'])

      const finalLease = await rig.plane.currentLease({ sessionId: 'fault-f7-1' })
      expect(finalLease.lease.holderId).toBe('host-b')
      expect(finalLease.lease.epoch).toBe(scenario.epochA + 1)

      const epochs = scenario.events.map((row) => (row.event as { epoch?: number }).epoch ?? 0)
      expect(Math.max(...epochs)).toBeLessThanOrEqual(finalLease.lease.epoch)
      const sorted = [...epochs].sort((a, b) => a - b)
      expect(epochs).toEqual(sorted)
    }, 90_000)

    it.skip('F7 healthy bash survives a self-fence [gap: drop() aborts before handoff and cancels it]', async () => {
      const scenario = await runOutage({ rig, sessionId: 'fault-f7-2' })
      expect(scenario.released).toBe(true)
      const results = scenario.events.filter(
        (row) => row.type === 'tool-result' && callIdOf(row) === 'c1',
      )
      expect(results.filter(isDoneResult).length).toBe(1)
    }, 90_000)
  },
)
