import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { GENESIS_HASH, verifySuffix, type V2Event } from '@dltech/atlas-core'
import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig } from '../../testing/fault-rig'
import { callIdOf, isDoneResult, makeFifo, readEvents, waitForFile } from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const waitForCommittedResult = async (args: {
  rig: FaultRig
  threadId: string
  timeoutMs?: number
}): Promise<void> => {
  const deadline = Date.now() + (args.timeoutMs ?? 15_000)
  for (;;) {
    const rows = await readEvents({ plane: args.rig.plane, threadId: args.threadId })
    if (rows.some((row) => row.type === 'tool-result' && callIdOf(row) === 'c1')) return
    if (Date.now() > deadline) throw new Error('the result append never committed')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

const readAllEvents = async (args: { rig: FaultRig; threadId: string }): Promise<V2Event[]> => {
  const page = await args.rig.plane.readEvents({
    threadId: args.threadId,
    afterSeq: 0,
    limit: 1_000,
    visible: false,
  })
  return page.events
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
      knobs: { queryTimeoutMs: 5_000 },
      scripts: {
        [sessionId]: [
          {
            calls: [{ callId: 'c1', name: 'bash', input: { description: 'gated', command: bash } }],
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

    rig.dbProxy.set({ latencyMs: 400 })
    writeFileSync(gateFifo, 'go\n')

    await waitForCommittedResult({ rig, threadId })
    rig.dbProxy.set({ holdDownstream: true })
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

    const all = await readAllEvents({ rig, threadId })
    const verified = verifySuffix({ trusted: { seq: 0, hash: GENESIS_HASH }, events: all })
    expect(verified.ok).toBe(true)
    if (verified.ok) {
      expect(verified.head).toEqual(await rig.plane.head({ threadId }))
    }

    const finalLease = await rig.plane.currentLease({ sessionId })
    expect(await rig.labelOf(finalLease.lease.holderHostId)).toBe('host-a')
    const epochs = events.map((row) => (row.event as { epoch?: number }).epoch ?? 0)
    expect(Math.max(...epochs)).toBeLessThanOrEqual(finalLease.lease.epoch)
    const sorted = [...epochs].sort((a, b) => a - b)
    expect(epochs).toEqual(sorted)
  }, 60_000)
})
