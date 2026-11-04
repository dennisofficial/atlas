import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig, type ReadEvent, type RigDaemon } from '../../testing/fault-rig'
import {
  callIdOf,
  expectEpochsOrdered,
  expectOneResultPerDispatch,
  makeFifo,
  readEvents,
  waitForFile,
} from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

type Scenario = {
  daemon: RigDaemon
  events: ReadEvent[]
  bootIds: { first: string; second: string; third: string }
}

describe.skipIf(REDIS_URL === undefined)('F17 kill the daemon mid bash and restart it', () => {
  const testDb = useTestDatabase()
  let rig: FaultRig

  beforeAll(async () => {
    rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
  }, 60_000)

  afterAll(async () => {
    await rig.stop()
  })

  const runScenario = async (slug: string): Promise<Scenario> => {
    const sessionId = `fault-f17-${slug}-${RUN}`
    const threadId = await rig.newSession({ sessionId, text: 'read then sleep' })
    const daemon = await rig.spawnDaemonFor({ sessionId })
    const first = daemon.bootId
    const payloadPath = join(daemon.home, `payload-${sessionId}.txt`)
    writeFileSync(payloadPath, 'PAYLOAD-MARKER\n')
    const startedFile = join(daemon.home, `started-${sessionId}`)
    const gateFifo = join(daemon.home, `gate-${sessionId}`)
    const runsFile = join(daemon.home, `runs-${sessionId}`)
    makeFifo({ path: gateFifo })
    const bash = `touch ${startedFile}; echo run >> ${runsFile}; cat ${gateFifo}; echo done`

    daemon.proxy.set({ latencyMs: 2_000 })
    const hostA = await rig.spawnHost({
      holderId: 'host-a',
      daemonUrl: daemon.url,
      scripts: {
        [sessionId]: [
          { calls: [{ callId: 'c1', name: 'read', input: { path: payloadPath } }] },
          {
            calls: [{ callId: 'c2', name: 'bash', input: { description: 'sleep', command: bash } }],
          },
          { text: 'host a recovered' },
        ],
      },
    })
    await rig.claim({ sessionId, holderId: 'host-a', timeoutMs: 30_000 })

    await rig.waitForSeq({
      threadId,
      want: (rows) => rows.some((row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1'),
      timeoutMs: 30_000,
    })
    daemon.proxy.set({ holdUpstream: true })

    const streaming = await readEvents({ plane: rig.plane, threadId })
    expect(streaming.some((row) => row.type === 'tool-result' && callIdOf(row) === 'c1')).toBe(
      false,
    )

    await daemon.restart({ keepHome: true })
    daemon.proxy.clear()
    const second = daemon.bootId
    expect(second).not.toBe(first)

    await rig
      .waitForSeq({
        threadId,
        want: (rows) =>
          rows.some(
            (row) =>
              row.type === 'tool-result' &&
              callIdOf(row) === 'c1' &&
              JSON.stringify(row.event).includes('PAYLOAD-MARKER'),
          ),
        timeoutMs: 30_000,
      })
      .catch((error: unknown) => {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}\nhostA logs:\n${hostA.logs().join('\n')}`,
        )
      })

    await waitForFile({ path: startedFile, timeoutMs: 30_000 })

    const midBash = await readEvents({ plane: rig.plane, threadId })
    expect(midBash.some((row) => row.type === 'tool-result' && callIdOf(row) === 'c2')).toBe(false)

    await daemon.restart({ keepHome: true })
    const third = daemon.bootId
    expect(third).not.toBe(second)

    const events = await rig
      .waitForSeq({
        threadId,
        want: (rows) =>
          rows.some(
            (row) =>
              row.type === 'assistant-said' &&
              JSON.stringify(row.event).includes('host a recovered'),
          ) && rows.some((row) => row.type === 'tool-result' && callIdOf(row) === 'c2'),
        timeoutMs: 30_000,
      })
      .catch((error: unknown) => {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}\nhostA logs:\n${hostA.logs().join('\n')}`,
        )
      })

    return { daemon, events, bootIds: { first, second, third } }
  }

  it('a read dispatched before the restart reruns and succeeds', async () => {
    const sessionId = `fault-f17-rerun-${RUN}`
    const { daemon, events, bootIds } = await runScenario('rerun')

    const readDispatch = events.filter(
      (row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1',
    )
    expect(readDispatch).toHaveLength(1)
    expect(readDispatch.map((row) => (row.event as { bootId?: string }).bootId)).toEqual([
      bootIds.first,
    ])

    const readResults = events.filter((row) => row.type === 'tool-result' && callIdOf(row) === 'c1')
    expect(readResults).toHaveLength(1)
    expect(readResults.map((row) => (row.event as { error?: unknown }).error)).toEqual([undefined])
    expect(JSON.stringify(readResults[0]?.event)).toContain('PAYLOAD-MARKER')

    const bashResults = events.filter((row) => row.type === 'tool-result' && callIdOf(row) === 'c2')
    expect(bashResults).toHaveLength(1)

    expectOneResultPerDispatch(events)

    const lease = await rig.plane.currentLease({ sessionId })
    expectEpochsOrdered({ events, finalEpoch: lease.lease.epoch })

    const runs = readFileSync(join(daemon.home, `runs-${sessionId}`), 'utf8')
    expect(runs.trim().split('\n')).toEqual(['run'])

    await daemon.stop()
    const orphans = spawnSync('pgrep', ['-f', daemon.home])
    expect(orphans.status).toBe(1)
  }, 90_000)

  it.skip('F17 bash reported interrupted after a daemon restart [gap: DaemonProcessPort maps a boot change to exit 1]', async () => {
    const { events, bootIds } = await runScenario('interrupted')

    const bashDispatch = events.filter(
      (row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c2',
    )
    expect(bashDispatch).toHaveLength(1)
    expect(bashDispatch.map((row) => (row.event as { bootId?: string }).bootId)).toEqual([
      bootIds.second,
    ])

    const bashResults = events.filter((row) => row.type === 'tool-result' && callIdOf(row) === 'c2')
    expect(bashResults).toHaveLength(1)
    expect(bashResults.map((row) => (row.event as { interrupted?: boolean }).interrupted)).toEqual([
      true,
    ])
  }, 90_000)
})
