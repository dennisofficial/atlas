import { describe, expect, it } from 'bun:test'

import { toThreadId, type ThreadId } from '@dltech/atlas-core'

import { ChildWake, type WakeSource, type WakeTarget } from '../child-wake'

const CHILD = toThreadId('brn_child')

function fakeSource(): WakeSource & {
  fire: () => void
  awaiting: ThreadId[]
  listenerCount: () => number
} {
  const listeners = new Set<() => void>()
  const awaiting: ThreadId[] = []
  return {
    awaiting,
    threadsAwaitingNotice: () => awaiting,
    onNotice: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    fire: () => {
      for (const listener of [...listeners]) listener()
    },
    listenerCount: () => listeners.size,
  }
}

function fakeTarget(): WakeTarget & { woken: ThreadId[] } {
  const woken: ThreadId[] = []
  return {
    woken,
    wake: async ({ agentId }) => {
      woken.push(agentId)
      return { ok: false }
    },
  }
}

describe('waking stopped children when a notice queues', () => {
  it('wakes every awaiting thread', async () => {
    const shells = fakeSource()
    shells.awaiting.push(CHILD)
    const target = fakeTarget()

    new ChildWake({ sources: [shells], agents: target })

    shells.fire()

    expect(target.woken).toEqual([CHILD])
  })

  it('ignores a source with nothing awaiting', async () => {
    const shells = fakeSource()
    const target = fakeTarget()

    new ChildWake({ sources: [shells], agents: target })

    shells.fire()

    expect(target.woken).toEqual([])
  })

  it('stops waking after dispose', async () => {
    const shells = fakeSource()
    shells.awaiting.push(CHILD)
    const target = fakeTarget()

    const wake = new ChildWake({ sources: [shells], agents: target })
    wake.dispose()

    shells.fire()

    expect(target.woken).toEqual([])
    expect(shells.listenerCount()).toBe(0)
  })
})
