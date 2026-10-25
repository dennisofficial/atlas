import { describe, expect, it } from 'bun:test'

import { EPodState, type PodStatus } from '@dltech/atlas-wire/web'

import { createPodStatusReader } from '../pod-status-reader'

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const pod = (state: EPodState): PodStatus => ({ state, steps: [] })

function rig(options?: { fail?: () => boolean }) {
  const seen: PodStatus[] = []
  const calls = { fetch: 0 }
  const reader = createPodStatusReader({
    threadId: 'thr_1',
    fetchPod: async () => {
      calls.fetch += 1
      if (options?.fail?.() === true) throw new Error('offline')
      return pod(calls.fetch === 1 ? EPodState.Booting : EPodState.Running)
    },
    onPod: (next) => seen.push(next),
  })
  return { reader, seen, calls }
}

describe('createPodStatusReader', () => {
  it('fetches once per refresh and reports each answer', async () => {
    const test = rig()
    test.reader.refresh()
    await flush()
    test.reader.refresh()
    await flush()
    expect(test.seen.map((next) => next.state)).toEqual([EPodState.Booting, EPodState.Running])
  })

  it('coalesces refreshes made while a fetch is in flight into one more fetch', async () => {
    const test = rig()
    test.reader.refresh()
    test.reader.refresh()
    test.reader.refresh()
    await flush()
    await flush()
    expect(test.calls.fetch).toBe(2)
  })

  it('keeps the last pod when a fetch fails and recovers on the next refresh', async () => {
    let failing = true
    const test = rig({ fail: () => failing })
    test.reader.refresh()
    await flush()
    expect(test.seen).toEqual([])

    failing = false
    test.reader.refresh()
    await flush()
    expect(test.seen).toHaveLength(1)
  })

  it('reports nothing after stop', async () => {
    const test = rig()
    test.reader.refresh()
    test.reader.stop()
    await flush()
    test.reader.refresh()
    await flush()
    expect(test.seen).toEqual([])
    expect(test.calls.fetch).toBe(1)
  })
})
