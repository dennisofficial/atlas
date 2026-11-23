import { describe, expect, it } from 'bun:test'

import { until } from '../../stream/__tests__/until'
import { busOf, frameOf, operationsOf, relayOf, sample, watch } from './pod-metrics-relay.fixtures'

describe('PodMetricsRelay', () => {
  it('relays the backlog once and then every live sample', async () => {
    const { ops, state } = operationsOf({ held: true, backlog: [sample(1_000)] })
    const { bus, frames } = busOf()
    relayOf({ ops, bus })
    await watch(bus, { watcherId: 'w1', ttlMs: 30 })
    await until(() => frames.length === 1, 'the backlog')
    expect(frames).toEqual([
      { sessionId: 's1', frame: { type: 'samples', samples: [sample(1_000)] } },
    ])
    state.listener?.(frameOf(sample(2_000)))
    await until(() => frames.length === 2, 'the live sample')
    expect(frames[1]).toEqual({
      sessionId: 's1',
      frame: { type: 'sample', sample: sample(2_000) },
    })
  })

  it('ignores events that are not metrics samples', async () => {
    const { ops, state } = operationsOf({ held: true, backlog: [] })
    const { bus, frames } = busOf()
    relayOf({ ops, bus })
    await watch(bus, { watcherId: 'w1', ttlMs: 30 })
    await until(() => frames.length === 1, 'the backlog')
    state.listener?.({
      kind: 'event',
      event: { type: 'watch.changed', watchId: 'w', paths: ['p'] },
    })
    state.listener?.(frameOf(sample(3_000)))
    await until(() => frames.length === 2, 'the live sample')
    expect(frames).toHaveLength(2)
  })

  it('hands a second watcher the ring once and not again on its renewals', async () => {
    const { ops } = operationsOf({ held: true, backlog: [sample(1_000)] })
    const { bus, frames } = busOf()
    relayOf({ ops, bus })
    await watch(bus, { watcherId: 'w1', ttlMs: 60_000 })
    await until(() => frames.length === 1, 'the first backlog')
    await watch(bus, { watcherId: 'w2', ttlMs: 60_000 })
    await until(() => frames.length === 2, 'the second backlog')
    await watch(bus, { watcherId: 'w1', ttlMs: 60_000 })
    await watch(bus, { watcherId: 'w2', ttlMs: 60_000 })
    expect(frames).toEqual([
      { sessionId: 's1', frame: { type: 'samples', samples: [sample(1_000)] } },
      { sessionId: 's1', frame: { type: 'samples', samples: [sample(1_000)] } },
    ])
  })

  it('stops relaying and unsubscribes from the pod when the lease lapses', async () => {
    const { ops, state, calls } = operationsOf({ held: true, backlog: [] })
    const { bus } = busOf()
    relayOf({ ops, bus })
    await watch(bus, { watcherId: 'w1', ttlMs: 20 })
    await until(() => calls.includes('metrics.unsubscribe'), 'the release')
    expect(state.dispose).toHaveBeenCalled()
  })

  it('keeps relaying while the watcher renews its lease', async () => {
    const { ops, state, calls } = operationsOf({ held: true, backlog: [] })
    const { bus } = busOf()
    relayOf({ ops, bus })
    for (let round = 0; round < 6; round += 1) {
      await watch(bus, { watcherId: 'w1', ttlMs: 100 })
      await new Promise<void>((resolve) => setTimeout(resolve, 20))
    }
    expect(state.dispose).not.toHaveBeenCalled()
    expect(calls).toEqual(['metrics.subscribe'])
    await until(() => calls.includes('metrics.unsubscribe'), 'the release')
  })

  it('stops relaying when the runtime closes', async () => {
    const { ops, state, calls } = operationsOf({ held: true, backlog: [] })
    const { bus } = busOf()
    relayOf({ ops, bus })
    await watch(bus, { watcherId: 'w1', ttlMs: 60_000 })
    await until(() => calls.includes('metrics.subscribe'), 'the subscribe')
    state.close?.()
    expect(state.dispose).toHaveBeenCalled()
    expect(calls).toEqual(['metrics.subscribe'])
  })

  it('says usage is unavailable when the pod is asleep and retries on the next request', async () => {
    const { ops, calls } = operationsOf({ held: true, backlog: null })
    const { bus, frames } = busOf()
    relayOf({ ops, bus })
    await watch(bus, { watcherId: 'w1', ttlMs: 30 })
    await until(() => frames.length === 1, 'the unavailable frame')
    expect(frames).toEqual([
      { sessionId: 's1', frame: { type: 'unavailable', reason: 'pod metrics are not readable' } },
    ])
    await watch(bus, { watcherId: 'w1', ttlMs: 30 })
    await until(() => calls.filter((op) => op === 'metrics.subscribe').length === 2, 'the retry')
  })

  it('says why when the pod cannot read metrics', async () => {
    const { ops } = operationsOf({
      held: true,
      subscribeFailure: 'cgroup memory file is not readable',
    })
    const { bus, frames } = busOf()
    relayOf({ ops, bus })
    await watch(bus, { watcherId: 'w1', ttlMs: 30 })
    await until(() => frames.length === 1, 'the unavailable frame')
    expect(frames).toEqual([
      {
        sessionId: 's1',
        frame: { type: 'unavailable', reason: 'cgroup memory file is not readable' },
      },
    ])
  })

  it('releases every relay when the module is destroyed', async () => {
    const { ops, state, calls } = operationsOf({ held: true, backlog: [] })
    const { bus } = busOf()
    const relay = relayOf({ ops, bus })
    await watch(bus, { watcherId: 'w1', ttlMs: 60_000 })
    await until(() => calls.includes('metrics.subscribe'), 'the subscribe')
    await relay.onModuleDestroy()
    expect(state.dispose).toHaveBeenCalled()
    expect(calls).toEqual(['metrics.subscribe', 'metrics.unsubscribe'])
  })
})
