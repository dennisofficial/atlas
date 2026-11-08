import { describe, expect, it } from 'bun:test'

import type { FollowPlane } from '../follow-types'
import { sharedReads } from '../shared-reads'

type Gate = { release(): void; fail(error: Error): void }

const gatedPlane = (): { plane: FollowPlane; calls: string[]; gate: (index?: number) => Gate } => {
  const calls: string[] = []
  const gates: Gate[] = []
  const pending = <T>(value: T, label: string): Promise<T> => {
    calls.push(label)
    return new Promise<T>((resolve, reject) => {
      gates.push({ release: () => resolve(value), fail: reject })
    })
  }
  const plane = {
    head: (params: { threadId: string }) =>
      pending({ seq: calls.length, hash: 'h' }, `head:${params.threadId}`),
    readEvents: (params: { threadId: string; afterSeq: number }) =>
      pending({ events: [], next: undefined }, `read:${params.threadId}:${params.afterSeq}`),
  } as unknown as FollowPlane
  return {
    plane,
    calls,
    gate: (index = gates.length - 1) => {
      const last = gates[index]
      if (last === undefined) throw new Error('no pending call')
      return last
    },
  }
}

const read = (afterSeq: number) => ({
  threadId: 't',
  afterSeq,
  limit: 200,
  visible: false,
  maxBytes: 1024,
})

describe('sharedReads', () => {
  it('serves two concurrent identical reads from one underlying call', async () => {
    const { plane, calls, gate } = gatedPlane()
    const shared = sharedReads(plane)
    const first = shared.readEvents(read(5))
    const second = shared.readEvents(read(5))
    gate().release()
    expect(await first).toBe(await second)
    expect(calls).toEqual(['read:t:5'])
  })

  it('does not share reads that differ in any key field', async () => {
    const { plane, calls } = gatedPlane()
    const shared = sharedReads(plane)
    void shared.readEvents(read(5))
    void shared.readEvents(read(6))
    void shared.readEvents({ ...read(5), visible: true })
    void shared.readEvents({ ...read(5), maxBytes: 2048 })
    void shared.readEvents({ ...read(5), limit: 10 })
    expect(calls).toHaveLength(5)
  })

  it('reads again once the first read has settled', async () => {
    const { plane, calls, gate } = gatedPlane()
    const shared = sharedReads(plane)
    const first = shared.readEvents(read(5))
    gate().release()
    await first
    const second = shared.readEvents(read(5))
    gate().release()
    await second
    expect(calls).toEqual(['read:t:5', 'read:t:5'])
  })

  it('shares head calls per thread while pending', async () => {
    const { plane, calls, gate } = gatedPlane()
    const shared = sharedReads(plane)
    const first = shared.head({ threadId: 't' })
    const second = shared.head({ threadId: 't' })
    void shared.head({ threadId: 'u' })
    gate(0).release()
    expect(await first).toBe(await second)
    expect(calls).toEqual(['head:t', 'head:u'])
  })

  it('hands a rejection to every caller and does not retain it', async () => {
    const { plane, calls, gate } = gatedPlane()
    const shared = sharedReads(plane)
    const first = shared.head({ threadId: 't' })
    const second = shared.head({ threadId: 't' })
    gate().fail(new Error('boom'))
    expect(first).rejects.toThrow('boom')
    expect(second).rejects.toThrow('boom')
    await first.catch(() => undefined)
    const retry = shared.head({ threadId: 't' })
    gate().release()
    await retry
    expect(calls).toEqual(['head:t', 'head:t'])
  })

  it('delegates the other plane methods with the plane as receiver', async () => {
    const seen: unknown[] = []
    const plane = {
      marker: 'plane',
      readSession(this: { marker: string }) {
        seen.push(this.marker)
        return Promise.resolve(undefined)
      },
    } as unknown as FollowPlane
    await sharedReads(plane).readSession({ sessionId: 's' })
    expect(seen).toEqual(['plane'])
  })
})
