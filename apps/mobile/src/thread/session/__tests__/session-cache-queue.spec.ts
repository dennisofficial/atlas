import { describe, expect, it } from 'bun:test'

import {
  memorySessionLog,
  restoredWindowResultOf,
  type SessionLog,
} from '@dltech/atlas-client/stream'
import { EStreamCacheOutcome } from '@dltech/atlas-protocol'
import { mintUserEvents } from '@dltech/atlas-client/stream-fixture'

import { queuedSessionLog } from '../session-cache-queue'

const headAt = (seq: number) => ({ seq, hash: `h${seq}` })

describe('the queued session log', () => {
  it('runs appends in the order they were asked for', async () => {
    const order: number[] = []
    const slow = (seq: number): Promise<void> =>
      new Promise((resolve) =>
        setTimeout(
          () => {
            order.push(seq)
            resolve()
          },
          seq === 1 ? 10 : 0,
        ),
      )
    const log = queuedSessionLog({
      ...memorySessionLog(),
      appendPage: ({ head }) => slow(head.seq),
    } satisfies SessionLog)

    await Promise.all([
      log.appendPage({ sessionId: 's1', events: [], head: headAt(1) }),
      log.appendPage({ sessionId: 's2', events: [], head: headAt(2) }),
    ])

    expect(order).toEqual([1, 2])
  })

  it('rejects failed operations to their caller and runs later operations in order', async () => {
    const order: string[] = []
    const failure = new Error('disk')
    const log = queuedSessionLog({
      ...memorySessionLog(),
      appendPage: async ({ sessionId }) => {
        order.push(sessionId)
        if (sessionId === 'first') throw failure
      },
    } satisfies SessionLog)

    const first = log.appendPage({ sessionId: 'first', events: [], head: headAt(1) })
    const second = log.appendPage({ sessionId: 'second', events: [], head: headAt(2) })
    const third = log.appendPage({ sessionId: 'third', events: [], head: headAt(3) })
    await expect(first).rejects.toBe(failure)
    await Promise.all([second, third, log.drain()])

    expect(order).toEqual(['first', 'second', 'third'])
  })

  it('reports a failed restore through the queue instead of an empty cache', async () => {
    const log = queuedSessionLog({
      ...memorySessionLog(),
      loadSnapshot: async () => {
        throw new Error('disk')
      },
    })

    expect(await restoredWindowResultOf({ log, sessionId: 's1', renderLimit: 10 })).toEqual({
      outcome: EStreamCacheOutcome.Failed,
      window: undefined,
    })
  })

  it('drains and stops taking work', async () => {
    const inner = memorySessionLog()
    const log = queuedSessionLog(inner)
    const events = mintUserEvents({ count: 2 })

    void log.appendPage({ sessionId: 's1', events, head: headAt(2) })
    log.stop()
    await log.drain()

    expect(await inner.readTail({ sessionId: 's1', count: 10 })).toEqual([])
  })
})
