import { closeSync, constants, openSync, readFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig, type HostProcess, type ReadEvent } from '../../testing/fault-rig'
import { callIdOf, isDoneResult, makeFifo, waitForFile } from './fault-support'

const APPEND_RETRY_MS = 2_500

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const waitForLog = async (args: {
  host: HostProcess
  text: string
  timeoutMs: number
}): Promise<void> => {
  const deadline = Date.now() + args.timeoutMs
  while (!args.host.logs().some((line) => line.includes(args.text))) {
    if (Date.now() > deadline) {
      throw new Error(
        `no "${args.text}" within ${args.timeoutMs} ms:\n${args.host.logs().join('\n')}`,
      )
    }
    await sleep(100)
  }
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
  stoppedAt: number
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
    label: 'host-a',
    daemonUrl: daemon.url,
    dbProxy: 'own',
    directPresence: true,
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

  await rig.claim({ sessionId, label: 'host-a' })
  await rig.waitForSeq({
    threadId,
    want: (rows) => rows.some((row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1'),
    timeoutMs: 20_000,
  })
  await waitForFile({ path: startedFile })
  const leaseA = await rig.plane.currentLease({ sessionId })
  expect(await rig.labelOf(leaseA.lease.holderHostId)).toBe('host-a')
  const epochA = leaseA.lease.epoch

  aDb.set({ refuse: true })
  const releasedAt = Date.now()
  const released = releaseFifo(gateFifo)

  let hostB: HostProcess | undefined
  try {
    hostB = await rig.spawnHost({
      label: 'host-b',
      daemonUrl: daemon.url,
      scripts: { [sessionId]: [{ text: 'host b finished' }] },
    })

    const stoppedAt = await waitForLog({
      host: hostA,
      text: 'append retry exhausted',
      timeoutMs: APPEND_RETRY_MS + 10_000,
    }).then(() => Date.now() - releasedAt)
    const whileDown = await rig.waitForSeq({ threadId, want: () => true })
    expect(whileDown.some((row) => row.type === 'tool-result' && callIdOf(row) === 'c1')).toBe(
      false,
    )
    await rig.claim({ sessionId, label: 'host-b', timeoutMs: 20_000 })

    aDb.clear()

    await rig
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
          `${error instanceof Error ? error.message : String(error)}\nhostB logs:\n${hostB?.logs().join('\n') ?? ''}`,
        )
      })
    await sleep(1_500)
    const events = await rig.waitForSeq({ threadId, want: () => true })

    return { events, released, stoppedAt, epochA, runsFile }
  } finally {
    for (const host of [hostA, hostB]) {
      if (host === undefined) continue
      host.kill('SIGKILL')
      await host.exited
    }
  }
}

describe.skipIf(REDIS_URL === undefined)(
  'F7 Postgres unreachable for 45 s scaled (append retry budget 2.5 s)',
  () => {
    const testDb = useTestDatabase()
    let rig: FaultRig

    beforeAll(async () => {
      rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
    }, 60_000)

    afterAll(async () => {
      await rig.stop()
    })

    it('stops appending after the retry budget and resumes on a new host without a double run', async () => {
      const scenario = await runOutage({ rig, sessionId: 'fault-f7-1' })

      expect(scenario.stoppedAt).toBeGreaterThanOrEqual(APPEND_RETRY_MS)
      expect(scenario.stoppedAt).toBeLessThan(APPEND_RETRY_MS + 10_000)

      const firstSuccessorSeq = Math.min(
        ...scenario.events
          .filter((row) => ((row.event as { epoch?: number }).epoch ?? 0) > scenario.epochA)
          .map((row) => row.seq),
      )
      const lateFromA = scenario.events.filter(
        (row) =>
          (row.event as { epoch?: number }).epoch === scenario.epochA &&
          row.seq > firstSuccessorSeq,
      )
      expect(lateFromA).toEqual([])

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
      expect(await rig.labelOf(finalLease.lease.holderHostId)).toBe('host-b')
      expect(finalLease.lease.epoch).toBe(scenario.epochA + 1)

      const epochs = scenario.events.map((row) => (row.event as { epoch?: number }).epoch ?? 0)
      expect(Math.max(...epochs)).toBeLessThanOrEqual(finalLease.lease.epoch)
      const sorted = [...epochs].sort((a, b) => a - b)
      expect(epochs).toEqual(sorted)
    }, 90_000)

    it('F7 healthy bash survives an append stop', async () => {
      const scenario = await runOutage({ rig, sessionId: 'fault-f7-2' })
      expect(scenario.released).toBe(true)
      const results = scenario.events.filter(
        (row) => row.type === 'tool-result' && callIdOf(row) === 'c1',
      )
      expect(results.filter(isDoneResult).length).toBe(1)
    }, 90_000)
  },
)
