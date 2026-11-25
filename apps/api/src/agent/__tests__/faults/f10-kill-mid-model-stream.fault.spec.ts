import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { ESessionStatus, sessionStatusOf, type RecordEvent } from '@dltech/atlas-core'
import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig, type ReadEvent } from '../../testing/fault-rig'
import { readEvents, waitForFile } from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const epochOf = (row: ReadEvent): number => (row.event as { epoch: number }).epoch

const v2EventsOf = (rows: readonly ReadEvent[]): RecordEvent[] =>
  rows.map((row) => row.event as RecordEvent)

const textOfAssistantSaid = (row: ReadEvent): string =>
  JSON.stringify((row.event as { parts?: unknown }).parts ?? [])

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const expectEpochsOrdered = (events: readonly ReadEvent[], finalEpoch: number): void => {
  let previous = -1
  for (const row of events) {
    const epoch = epochOf(row)
    expect(epoch).toBeLessThanOrEqual(finalEpoch)
    expect(epoch).toBeGreaterThanOrEqual(previous)
    previous = epoch
  }
}

describe.skipIf(REDIS_URL === undefined)(
  'F10 SIGKILL the holder mid model stream (90 s resume scaled to TTL 3 s)',
  () => {
    const testDb = useTestDatabase()
    let rig: FaultRig

    beforeAll(async () => {
      rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
    }, 60_000)

    afterAll(async () => {
      await rig.stop()
    })

    it('exit 3a: the second host takes over and finishes the turn', async () => {
      const sessionId = 'fault-f10-1'
      const threadId = await rig.newSession({ sessionId, text: 'tell me a story' })
      const daemon = await rig.spawnDaemonFor({ sessionId })
      const chunkFile = join(daemon.home, `chunk-${sessionId}`)
      const streamed = 'once upon a midnight dreary '.repeat(20)

      const hostA = await rig.spawnHost({
        label: 'host-a',
        daemonUrl: daemon.url,
        firstChunkFile: chunkFile,
        scripts: { [sessionId]: [{ text: streamed, streamMs: 30_000 }] },
      })
      await rig.claim({ sessionId, label: 'host-a' })
      await waitForFile({ path: chunkFile })

      const before = await readEvents({ plane: rig.plane, threadId })
      expect(before.some((row) => row.type === 'assistant-said')).toBe(false)
      const leaseBefore = await rig.plane.currentLease({ sessionId })
      expect(await rig.labelOf(leaseBefore.lease.holderHostId)).toBe('host-a')

      hostA.kill('SIGKILL')
      await hostA.exited

      const status = sessionStatusOf({
        events: v2EventsOf(before),
        live: false,
        queuedSince: null,
        now: new Date().toISOString(),
      })
      expect(status.state).toBe(ESessionStatus.Resuming)

      const hostB = await rig.spawnHost({
        label: 'host-b',
        daemonUrl: daemon.url,
        scripts: { [sessionId]: [{ text: 'host b finished' }] },
      })
      await rig.claim({ sessionId, label: 'host-b', timeoutMs: 20_000 })

      await rig
        .waitForSeq({
          threadId,
          want: (rows) =>
            rows.some(
              (row) =>
                row.type === 'assistant-said' &&
                textOfAssistantSaid(row).includes('host b finished'),
            ),
          timeoutMs: 30_000,
        })
        .catch((error: unknown) => {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}\nhostB logs:\n${hostB.logs().join('\n')}`,
          )
        })

      const events = await readEvents({ plane: rig.plane, threadId })
      const said = events.filter((row) => row.type === 'assistant-said')
      expect(said.length).toBe(1)
      expect(textOfAssistantSaid(said[0] as ReadEvent)).toContain('host b finished')

      const lease = await rig.plane.currentLease({ sessionId })
      expect(epochOf(said[0] as ReadEvent)).toBeGreaterThan(leaseBefore.lease.epoch)
      expect(await rig.labelOf(lease.lease.holderHostId)).not.toBe('host-a')
      expectEpochsOrdered(events, lease.lease.epoch)

      hostB.kill('SIGKILL')
      await hostB.exited
    }, 60_000)

    it('exit 3b: SIGTERM mid model stream lets the reply commit whole, without a second answer', async () => {
      const sessionId = 'fault-f10-3b'
      const threadId = await rig.newSession({ sessionId, text: 'tell me a story' })
      const daemon = await rig.spawnDaemonFor({ sessionId })
      const chunkFile = join(daemon.home, `chunk-${sessionId}`)
      const streamed = 'while i nodded nearly napping '.repeat(20)

      const hostA = await rig.spawnHost({
        label: 'host-a',
        daemonUrl: daemon.url,
        firstChunkFile: chunkFile,
        scripts: { [sessionId]: [{ text: streamed, streamMs: 15_000 }] },
      })
      await rig.claim({ sessionId, label: 'host-a', timeoutMs: 30_000 })
      await waitForFile({ path: chunkFile })

      const before = await readEvents({ plane: rig.plane, threadId })
      expect(before.some((row) => row.type === 'assistant-said')).toBe(false)
      const leaseBefore = await rig.plane.currentLease({ sessionId })
      expect(await rig.labelOf(leaseBefore.lease.holderHostId)).toBe('host-a')

      hostA.kill('SIGTERM')
      await hostA.exited

      const after = await readEvents({ plane: rig.plane, threadId })
      const said = after.filter((row) => row.type === 'assistant-said')
      expect(said).toHaveLength(1)
      const whole = said[0]?.event as { aborted?: string; interrupted?: boolean }
      expect(whole.aborted).toBeUndefined()
      expect(whole.interrupted).toBeUndefined()
      expect(textOfAssistantSaid(said[0] as ReadEvent)).toContain(streamed)
      expect(after.filter((row) => row.type === 'nudge')).toEqual([])

      const lease = await rig.plane.currentLease({ sessionId })
      expect(lease.lease.holderHostId).toBeNull()
      expectEpochsOrdered(after, lease.lease.epoch)

      const hostB = await rig.spawnHost({
        label: 'host-b',
        daemonUrl: daemon.url,
        scripts: { [sessionId]: [{ text: 'host b finished' }] },
      })
      await rig.wake(sessionId)
      await sleep(2_000)

      const later = await readEvents({ plane: rig.plane, threadId })
      expect(later.filter((row) => row.type === 'assistant-said')).toHaveLength(1)
      expect(later.filter((row) => row.type === 'nudge')).toEqual([])

      hostB.kill('SIGKILL')
      await hostB.exited
    }, 60_000)
  },
)
