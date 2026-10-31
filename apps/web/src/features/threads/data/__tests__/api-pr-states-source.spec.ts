import { describe, expect, it } from 'bun:test'

import { EGithubPrStatesFrame, type PrStateWire } from '@dltech/atlas-wire/web'

import { subscribeApiPrStates, type ApiPrStatesSubscribe } from '../api-pr-states-source'

function frameOf({ checksPassed, repo = 'o/r' }: { checksPassed: number; repo?: string }) {
  return {
    type: EGithubPrStatesFrame.PrState as const,
    state: {
      repoFullName: repo,
      prNumber: 760,
      title: 't',
      url: 'u',
      state: 'open',
      headBranch: 'b',
      headSha: 's',
      checksRunning: 0,
      checksPassed,
      checksFailed: 0,
      mergeable: null,
      updatedAt: '',
    },
  }
}

function sourceRig() {
  const subscriptions: { handlers: Parameters<ApiPrStatesSubscribe>[0]; stops: number }[] = []
  const subscribe: ApiPrStatesSubscribe = (handlers) => {
    const entry = { handlers, stops: 0 }
    subscriptions.push(entry)
    return {
      unsubscribe: () => {
        entry.stops += 1
      },
    }
  }
  return { subscriptions, subscribe, push: () => subscriptions.at(-1)?.handlers }
}

describe('subscribeApiPrStates', () => {
  it('accumulates and replaces api states by normalized repo and number', () => {
    const rig = sourceRig()
    const seen: (readonly PrStateWire[])[] = []
    const stop = subscribeApiPrStates({
      subscribe: rig.subscribe,
      onStates: (states) => seen.push(states),
    })
    rig.push()?.onData({ type: EGithubPrStatesFrame.Heartbeat })
    rig.push()?.onData(frameOf({ checksPassed: 1 }))
    rig.push()?.onData(frameOf({ checksPassed: 2, repo: 'github.com/O/R' }))
    rig.push()?.onData(frameOf({ checksPassed: 3, repo: 'other/repo' }))
    stop()
    expect(seen.map((states) => states.map((state) => state.checksPassed))).toEqual([
      [1],
      [2],
      [2, 3],
    ])
    expect(rig.subscriptions[0]?.stops).toBe(1)
  })

  it('shares one connection, replays the cache, and broadcasts while any consumer remains', () => {
    const rig = sourceRig()
    const first: (readonly PrStateWire[])[] = []
    const second: (readonly PrStateWire[])[] = []
    const stopFirst = subscribeApiPrStates({
      subscribe: rig.subscribe,
      onStates: (states) => first.push(states),
    })
    rig.push()?.onData(frameOf({ checksPassed: 1 }))
    const stopSecond = subscribeApiPrStates({
      subscribe: rig.subscribe,
      onStates: (states) => second.push(states),
    })
    expect(rig.subscriptions).toHaveLength(1)
    expect(second).toEqual(first)
    rig.push()?.onData(frameOf({ checksPassed: 2 }))
    expect(second.at(-1)).toBe(first.at(-1))
    stopFirst()
    stopFirst()
    expect(rig.subscriptions[0]?.stops).toBe(0)
    rig.push()?.onData(frameOf({ checksPassed: 3 }))
    expect(first.at(-1)?.[0]?.checksPassed).toBe(2)
    expect(second.at(-1)?.[0]?.checksPassed).toBe(3)
    stopSecond()
    expect(rig.subscriptions[0]?.stops).toBe(1)
    rig.push()?.onData(frameOf({ checksPassed: 4 }))
    expect(second.at(-1)?.[0]?.checksPassed).toBe(3)
  })

  it('does not conflate independent transports or retain cache after the last consumer leaves', () => {
    const firstRig = sourceRig()
    const otherRig = sourceRig()
    const first: (readonly PrStateWire[])[] = []
    const other: (readonly PrStateWire[])[] = []
    const stopFirst = subscribeApiPrStates({
      subscribe: firstRig.subscribe,
      onStates: (states) => first.push(states),
    })
    const stopOther = subscribeApiPrStates({
      subscribe: otherRig.subscribe,
      onStates: (states) => other.push(states),
    })
    firstRig.push()?.onData(frameOf({ checksPassed: 1 }))
    expect(other).toEqual([])
    stopFirst()
    const remounted: (readonly PrStateWire[])[] = []
    const stopRemounted = subscribeApiPrStates({
      subscribe: firstRig.subscribe,
      onStates: (states) => remounted.push(states),
    })
    expect(firstRig.subscriptions).toHaveLength(2)
    expect(remounted).toEqual([])
    stopRemounted()
    stopOther()
  })

  it('reconnects once for duplicate endings, rejects stale frames, and cancels the final retry', async () => {
    const rig = sourceRig()
    const first: (readonly PrStateWire[])[] = []
    const second: (readonly PrStateWire[])[] = []
    const stopFirst = subscribeApiPrStates({
      subscribe: rig.subscribe,
      onStates: (states) => first.push(states),
    })
    const stopSecond = subscribeApiPrStates({
      subscribe: rig.subscribe,
      onStates: (states) => second.push(states),
    })
    const old = rig.push()
    old?.onData(frameOf({ checksPassed: 1 }))
    old?.onError(new Error('offline'))
    old?.onComplete()
    old?.onData(frameOf({ checksPassed: 99 }))
    expect(rig.subscriptions[0]?.stops).toBe(1)
    await Bun.sleep(1100)
    expect(rig.subscriptions).toHaveLength(2)
    rig.push()?.onData(frameOf({ checksPassed: 2 }))
    expect(first.at(-1)?.[0]?.checksPassed).toBe(2)
    expect(second.at(-1)?.[0]?.checksPassed).toBe(2)
    rig.push()?.onComplete()
    stopFirst()
    stopSecond()
    await Bun.sleep(1100)
    expect(rig.subscriptions).toHaveLength(2)
  })

  it('cleans up a transport that completes synchronously during subscription', () => {
    let stops = 0
    const stop = subscribeApiPrStates({
      subscribe: (handlers) => {
        handlers.onComplete()
        return {
          unsubscribe: () => {
            stops += 1
          },
        }
      },
      onStates: () => undefined,
    })
    stop()
    expect(stops).toBe(1)
  })
})
