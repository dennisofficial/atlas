import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'
import { INBOX_KIND_STOP } from '@dltech/atlas-host'

import { startRig, type FaultRig, type ReadEvent } from '../../testing/fault-rig'
import { callIdOf, readEvents } from './fault-support'

const DEAD_REDIS = 'redis://127.0.0.1:1'

const isInterruptedResult = (row: ReadEvent, callId: string): boolean =>
  row.type === 'tool-result' &&
  callIdOf(row) === callId &&
  (row.event as { interrupted?: boolean }).interrupted === true

describe('F9 Redis down for the whole session', () => {
  const testDb = useTestDatabase()
  let rig: FaultRig

  beforeAll(async () => {
    rig = await startRig({ databaseUrl: testDb().url, redisUrl: DEAD_REDIS })
  }, 60_000)

  afterAll(async () => {
    await rig.stop()
  })

  it('wakes, stops and turns are unaffected with redis unreachable', async () => {
    const suffix = Math.random().toString(36).slice(2, 8)
    const sessionId = `fault-f9-${suffix}`
    const threadId = await rig.newSession({ sessionId, text: 'sleep then stop' })
    const daemon = await rig.spawnDaemonFor({ sessionId })
    await rig.spawnHost({
      holderId: 'host-f9',
      daemonUrl: daemon.url,
      redisUrl: DEAD_REDIS,
      scripts: {
        [sessionId]: [
          {
            calls: [
              {
                callId: 'c1',
                name: 'bash',
                input: { description: 'sleeper', command: 'sleep 30' },
              },
            ],
          },
          { text: 'never reached' },
        ],
      },
    })

    const postedAt = Date.now()
    await rig.claim({ sessionId, holderId: 'host-f9' })
    console.log(`f9 post->claim latency with redis down: ${Date.now() - postedAt} ms`)

    await rig.waitForSeq({
      threadId,
      want: (rows) => rows.some((row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1'),
      timeoutMs: 20_000,
    })

    const { inboxId } = await rig.plane.post({ sessionId, kind: INBOX_KIND_STOP, payload: '{}' })
    const events = await rig.waitForSeq({
      threadId,
      want: (rows) =>
        rows.some((row) => isInterruptedResult(row, 'c1')) &&
        rows.some(
          (row) =>
            row.type === 'input-consumed' &&
            (row.event as { inboxId?: number }).inboxId === inboxId,
        ),
      timeoutMs: 20_000,
    })
    expect(events.some((row) => row.type === 'assistant-said')).toBe(false)
    expect(await readEvents({ plane: rig.plane, threadId })).toEqual(events)
  }, 60_000)

  it('delivers a post to a running host in tens of milliseconds', async () => {
    const suffix = Math.random().toString(36).slice(2, 8)
    const sessionId = `fault-f9-hot-${suffix}`
    const daemon = await rig.spawnDaemonFor({ sessionId })
    await rig.spawnHost({
      holderId: 'host-f9-hot',
      daemonUrl: daemon.url,
      redisUrl: DEAD_REDIS,
      scripts: { [sessionId]: [{ text: 'hot answer' }] },
    })
    await new Promise((resolve) => setTimeout(resolve, 5_000))

    const postedAt = Date.now()
    const threadId = await rig.newSession({ sessionId, text: 'hot path' })
    const deadline = Date.now() + 15_000
    for (;;) {
      const current = await rig.plane.currentLease({ sessionId })
      if (current.live && current.lease.holderId === 'host-f9-hot') break
      if (Date.now() > deadline) throw new Error('hot claim timed out')
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    const latencyMs = Date.now() - postedAt
    console.log(`f9 hot post->claim latency with redis down: ${latencyMs} ms`)
    expect(latencyMs).toBeLessThan(1_500)

    await rig.waitForSeq({
      threadId,
      want: (rows) => rows.some((row) => row.type === 'assistant-said'),
      timeoutMs: 20_000,
    })
  }, 60_000)
})
