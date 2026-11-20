import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig, type ReadEvent } from '../../testing/fault-rig'
import { readEvents, waitForFile } from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const PHRASE = 'the reply a drain must not cut short. '
const REPEATS = 20
const STREAMED = PHRASE.repeat(REPEATS)

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const saidsOf = (rows: readonly ReadEvent[]): ReadEvent[] =>
  rows.filter((row) => row.type === 'assistant-said')

const nudgesOf = (rows: readonly ReadEvent[]): ReadEvent[] =>
  rows.filter((row) => row.type === 'nudge')

const textOf = (row: ReadEvent): string =>
  JSON.stringify((row.event as { parts?: unknown }).parts ?? [])

const phrasesIn = (row: ReadEvent): number => textOf(row).split(PHRASE).length - 1

const handoffMarkOf = (row: ReadEvent): { aborted?: string; interrupted?: boolean } =>
  row.event as { aborted?: string; interrupted?: boolean }

describe.skipIf(REDIS_URL === undefined)('F48 SIGTERM the holder mid model stream', () => {
  const testDb = useTestDatabase()
  let rig: FaultRig

  beforeAll(async () => {
    rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
  }, 60_000)

  afterAll(async () => {
    await rig.stop()
  })

  it('lets the stream commit once, records it whole, and nudges nothing', async () => {
    const sessionId = 'fault-f48-1'
    const threadId = await rig.newSession({ sessionId, text: 'tell me a story' })
    const daemon = await rig.spawnDaemonFor({ sessionId })
    const chunkFile = join(daemon.home, `chunk-${sessionId}`)

    const hostA = await rig.spawnHost({
      label: 'host-a',
      daemonUrl: daemon.url,
      firstChunkFile: chunkFile,
      scripts: { [sessionId]: [{ text: STREAMED, streamMs: 15_000 }] },
    })
    await rig.claim({ sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitForFile({ path: chunkFile })

    const before = await readEvents({ plane: rig.plane, threadId })
    expect(saidsOf(before)).toEqual([])
    const leaseBefore = await rig.plane.currentLease({ sessionId })
    expect(await rig.labelOf(leaseBefore.lease.holderHostId)).toBe('host-a')

    hostA.kill('SIGTERM')
    await hostA.exited

    const drained = await readEvents({ plane: rig.plane, threadId })
    const said = saidsOf(drained)
    expect(said).toHaveLength(1)
    const partial = said[0] as ReadEvent
    expect(handoffMarkOf(partial).aborted).toBeUndefined()
    expect(handoffMarkOf(partial).interrupted).toBeUndefined()
    expect(phrasesIn(partial)).toBe(REPEATS)
    expect(nudgesOf(drained)).toEqual([])

    const lease = await rig.plane.currentLease({ sessionId })
    expect(lease.lease.holderHostId).toBeNull()
    expect(lease.lease.epoch).toBeGreaterThanOrEqual(leaseBefore.lease.epoch)

    const hostB = await rig.spawnHost({
      label: 'host-b',
      daemonUrl: daemon.url,
      scripts: { [sessionId]: [{ text: 'host b finished' }] },
    })
    await rig.wake(sessionId)
    await sleep(2_000)

    const after = await readEvents({ plane: rig.plane, threadId })
    expect(saidsOf(after)).toHaveLength(1)
    expect(phrasesIn(saidsOf(after)[0] as ReadEvent)).toBe(REPEATS)
    expect(nudgesOf(after)).toEqual([])
    expect(after.filter((row) => row.type === 'assistant-said' && row.seq !== partial.seq)).toEqual(
      [],
    )

    hostB.kill('SIGKILL')
    await hostB.exited
  }, 60_000)
})
