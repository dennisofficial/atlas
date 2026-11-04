import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig, type ReadEvent } from '../../testing/fault-rig'
import { callIdOf, isDoneResult, makeFifo, readEvents, waitForFile } from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const isInterruptedResult = (row: ReadEvent): boolean => {
  if (row.type !== 'tool-result') return false
  return !isDoneResult(row)
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

  it('a read dispatched before the restart reruns; the bash is interrupted', async () => {
    const sessionId = 'fault-f17-1'
    const threadId = await rig.newSession({ sessionId, text: 'read then sleep' })
    const daemon = await rig.spawnDaemonFor({ sessionId })
    const bootId1 = daemon.bootId
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
    const bootId2 = daemon.bootId
    expect(bootId2).not.toBe(bootId1)

    const afterRead = await rig
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
    expect(
      afterRead.filter((row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1'),
    ).toHaveLength(1)

    await waitForFile({ path: startedFile, timeoutMs: 30_000 })

    const midBash = await readEvents({ plane: rig.plane, threadId })
    expect(midBash.some((row) => row.type === 'tool-result' && callIdOf(row) === 'c2')).toBe(false)

    await daemon.restart({ keepHome: true })
    const bootId3 = daemon.bootId
    expect(bootId3).not.toBe(bootId2)

    const events = await rig
      .waitForSeq({
        threadId,
        want: (rows) =>
          rows.some((row) => row.type === 'assistant-said') &&
          rows.some((row) => row.type === 'tool-result' && callIdOf(row) === 'c2'),
        timeoutMs: 30_000,
      })
      .catch((error: unknown) => {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}\nhostA logs:\n${hostA.logs().join('\n')}`,
        )
      })

    const c1Dispatches = events.filter(
      (row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1',
    )
    const c1Results = events.filter((row) => row.type === 'tool-result' && callIdOf(row) === 'c1')
    expect(c1Dispatches).toHaveLength(1)
    expect(c1Results).toHaveLength(1)

    const c2Results = events.filter((row) => row.type === 'tool-result' && callIdOf(row) === 'c2')
    expect(c2Results).toHaveLength(1)
    expect(c2Results.filter(isInterruptedResult)).toHaveLength(1)

    const runs = readFileSync(runsFile, 'utf8').trim().split('\n')
    expect(runs).toEqual(['run'])

    const dispatched = events.filter((row) => row.type === 'tool-dispatched')
    for (const marker of dispatched) {
      const id = callIdOf(marker)
      expect(
        events.filter((row) => row.type === 'tool-result' && callIdOf(row) === id),
      ).toHaveLength(1)
    }
  }, 90_000)
})
