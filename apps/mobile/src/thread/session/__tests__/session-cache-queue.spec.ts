import { describe, expect, it } from 'bun:test'

import { memorySessionLog, type SessionLog } from '@dltech/atlas-client/stream'
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

  it('keeps taking work after an operation fails', async () => {
    const inner = memorySessionLog()
    const log = queuedSessionLog({
      ...inner,
      appendPage: ({ sessionId }) =>
        sessionId === 'first' ? Promise.reject(new Error('disk')) : Promise.resolve(),
    } satisfies SessionLog)

    await log.appendPage({ sessionId: 'first', events: [], head: headAt(1) })
    await log.appendPage({ sessionId: 'second', events: [], head: headAt(2) })

    expect(await inner.listSessions()).toEqual([])
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
