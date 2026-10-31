import { describe, expect, it } from 'bun:test'

import { EPodState } from '@dltech/atlas-wire/web'

import { createThreadSignalHub } from '../thread-signal-hub'

describe('createThreadSignalHub', () => {
  it('fans each signal out to every listener that handles it', () => {
    const hub = createThreadSignalHub()
    const heads: number[] = []
    let pods = 0
    let titles = 0
    let starts = 0
    hub.listen({ onHead: (head) => heads.push(head) })
    hub.listen({
      onPod: () => {
        pods += 1
      },
      onTitle: () => {
        titles += 1
      },
      onStarted: () => {
        starts += 1
      },
    })

    hub.emitHead(2)
    hub.emitPod()
    hub.emitTitle()
    hub.emitStarted()

    expect({ heads, pods, titles, starts }).toEqual({ heads: [2], pods: 1, titles: 1, starts: 1 })
  })

  it('fans metadata and Pod payloads out and preserves bare Pod listeners', () => {
    const hub = createThreadSignalHub()
    const metadata = {
      thread: {
        id: 'thr_1',
        head: 0,
        workspace: null,
        repo: null,
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T00:00:00.000Z',
      },
      rev: 1,
    }
    const seen: unknown[] = []
    const unlisten = hub.listen({
      onMeta: (frame) => seen.push(frame),
      onPod: (payload) => seen.push(payload),
    })
    const status = { state: EPodState.Running, steps: [] }
    hub.emitMeta(metadata)
    hub.emitPod({ status, rev: 6 })
    hub.emitPod({ status })
    hub.emitPod()
    expect(seen).toEqual([metadata, { status, rev: 6 }, { status }, {}])
    unlisten()
    hub.emitMeta(metadata)
    hub.emitPod()
    expect(seen).toHaveLength(4)
  })

  it('stops delivering to a listener once it unlistens', () => {
    const hub = createThreadSignalHub()
    const heads: number[] = []
    const unlisten = hub.listen({ onHead: (head) => heads.push(head) })
    hub.emitHead(1)
    unlisten()
    hub.emitHead(2)
    expect(heads).toEqual([1])
  })
})
