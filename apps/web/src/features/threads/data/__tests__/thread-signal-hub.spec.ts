import { describe, expect, it } from 'bun:test'

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
