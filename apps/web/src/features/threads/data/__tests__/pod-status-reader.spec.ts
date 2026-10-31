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

function httpRig(initial: PodStatus) {
  let next = initial
  const seen: PodStatus[] = []
  const reader = createPodStatusReader({
    threadId: 'thr_1',
    fetchPod: async () => next,
    onPod: (status) => seen.push(status),
  })
  return {
    reader,
    seen,
    setNext: (status: PodStatus) => {
      next = status
    },
  }
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

  it('applies status directly without a GET and ignores a late initial GET', async () => {
    const seen: PodStatus[] = []
    let release: (status: PodStatus) => void = () => undefined
    let reads = 0
    const reader = createPodStatusReader({
      threadId: 'thr_1',
      fetchPod: () => {
        reads += 1
        return new Promise((resolve) => {
          release = resolve
        })
      },
      onPod: (status) => seen.push(status),
    })
    reader.refresh()
    reader.refresh()
    const live = pod(EPodState.Running)
    reader.apply({ status: live })
    release(pod(EPodState.Booting))
    await flush()
    expect(reads).toBe(1)
    expect(seen).toEqual([live])
    reader.stop()
  })

  it('retains resources only for lifecycle frames in the same running state', async () => {
    const test = rig()
    const resources = { sandboxId: 'sandbox_1', region: 'iad1', vcpus: 4 }
    test.reader.apply({ status: { ...pod(EPodState.Running), resources } })
    test.reader.apply({ status: pod(EPodState.Running) })
    expect(test.seen.at(-1)?.resources).toEqual(resources)
    const resized = { ...resources, vcpus: 8 }
    test.reader.apply({ status: { ...pod(EPodState.Running), resources: resized } })
    expect(test.seen.at(-1)?.resources).toEqual(resized)
    test.reader.apply({ status: pod(EPodState.Parked) })
    expect(test.seen.at(-1)?.resources).toBeUndefined()
    test.reader.apply({ status: pod(EPodState.Running) })
    expect(test.seen.at(-1)?.resources).toBeUndefined()
    test.reader.apply({ status: { ...pod(EPodState.Booting), resources } })
    test.reader.apply({ status: pod(EPodState.Booting) })
    expect(test.seen.at(-1)?.resources).toBeUndefined()
    expect(test.calls.fetch).toBe(0)
    test.reader.stop()
  })

  it('ignores an old manual GET after a live frame but permits a later manual GET', async () => {
    const seen: PodStatus[] = []
    let release: (status: PodStatus) => void = () => undefined
    const reader = createPodStatusReader({
      threadId: 'thr_1',
      fetchPod: () =>
        new Promise((resolve) => {
          release = resolve
        }),
      onPod: (status) => seen.push(status),
    })
    reader.apply({ status: pod(EPodState.Booting) })
    reader.refresh()
    reader.apply({ status: pod(EPodState.Running) })
    release(pod(EPodState.Failed))
    await flush()
    expect(seen.map((status) => status.state)).toEqual([EPodState.Booting, EPodState.Running])
    reader.refresh()
    release(pod(EPodState.Parked))
    await flush()
    expect(seen.at(-1)?.state).toBe(EPodState.Parked)
    reader.stop()
  })

  it('drops out-of-order and duplicate revisions without fetching, then accepts a fresh revision', () => {
    const test = rig()
    const running = pod(EPodState.Running)
    const parked = pod(EPodState.Parked)
    test.reader.apply({ status: running, rev: 6 })
    test.reader.apply({ status: pod(EPodState.Booting), rev: 5 })
    test.reader.apply({ status: running, rev: 6 })
    expect(test.seen).toEqual([running])
    test.reader.apply({ status: parked, rev: 7 })
    expect(test.seen).toEqual([running, parked])
    expect(test.calls.fetch).toBe(0)
    test.reader.stop()
  })

  it('does not let stale payloads invalidate a fresh manual GET', async () => {
    const seen: PodStatus[] = []
    let release: (status: PodStatus) => void = () => undefined
    const reader = createPodStatusReader({
      threadId: 'thr_1',
      fetchPod: () =>
        new Promise((resolve) => {
          release = resolve
        }),
      onPod: (status) => seen.push(status),
    })
    const running = pod(EPodState.Running)
    reader.apply({ status: running, rev: 6 })
    reader.refresh()
    reader.apply({ status: pod(EPodState.Booting), rev: 5 })
    reader.apply({ status: running, rev: 6 })
    const resources = { sandboxId: 'sandbox_1', region: 'iad1', vcpus: 8 }
    release({ ...running, resources })
    await flush()
    expect(seen).toEqual([running, { ...running, resources }])
    reader.stop()
  })

  it('accepts legacy unversioned status without forgetting the last known revision', () => {
    const test = rig()
    const running = pod(EPodState.Running)
    const parked = pod(EPodState.Parked)
    test.reader.apply({ status: running, rev: 6 })
    test.reader.apply({ status: parked })
    test.reader.apply({ status: pod(EPodState.Booting), rev: 5 })
    expect(test.seen).toEqual([running, parked])
    expect(test.calls.fetch).toBe(0)
    test.reader.stop()
  })

  it('uses the initial HTTP revision as the floor and falls back to status.rev for frames', async () => {
    const initial = { ...pod(EPodState.Running), rev: 6 }
    const test = httpRig(initial)
    test.reader.refresh()
    await flush()
    test.reader.apply({ status: { ...pod(EPodState.Booting), rev: 5 } })
    test.reader.apply({ status: { ...pod(EPodState.Failed), rev: 6 } })
    expect(test.seen).toEqual([initial])
    const next = { ...pod(EPodState.Parked), rev: 7 }
    test.reader.apply({ status: next })
    expect(test.seen).toEqual([initial, next])
    test.reader.stop()
  })

  it('shares the revision floor across manual GETs and prefers the outer frame revision', async () => {
    const running = { ...pod(EPodState.Running), rev: 6 }
    const test = httpRig(running)
    test.reader.apply({ status: pod(EPodState.Booting), rev: 4 })
    test.reader.refresh()
    await flush()
    test.reader.apply({ status: pod(EPodState.Booting), rev: 5 })
    expect(test.seen.at(-1)).toEqual(running)
    const parked = { ...pod(EPodState.Parked), rev: 5 }
    test.reader.apply({ status: parked, rev: 7 })
    expect(test.seen.at(-1)).toEqual(parked)
    test.setNext({ ...pod(EPodState.Running), rev: 6 })
    test.reader.refresh()
    await flush()
    expect(test.seen).toHaveLength(3)
    test.reader.stop()
  })

  it('accepts equal-revision HTTP resources after a frame but still drops equal frames', async () => {
    const running = { ...pod(EPodState.Running), rev: 6 }
    const resources = { sandboxId: 'sandbox_1', region: 'iad1', vcpus: 8 }
    const refreshed = { ...running, resources }
    const test = httpRig(refreshed)
    test.reader.apply({ status: running, rev: 6 })
    test.reader.refresh()
    await flush()
    test.reader.apply({ status: running, rev: 6 })
    expect(test.seen).toEqual([running, refreshed])
    test.reader.stop()
  })

  it('ignores old reader status after a thread switch', async () => {
    const test = rig()
    test.reader.refresh()
    test.reader.stop()
    test.reader.apply({ status: pod(EPodState.Running) })
    const next = rig()
    next.reader.apply({ status: pod(EPodState.Parked) })
    await flush()
    expect(test.seen).toEqual([])
    expect(next.seen).toEqual([pod(EPodState.Parked)])
    next.reader.stop()
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
