import { describe, expect, it, vi } from 'bun:test'
import type { EventFrame, PodCallOutcome } from '@dltech/atlas-host'
import {
  ECallFailure,
  ECallStatus,
  ELiveOpFailure,
  type PodMetricsFrame,
  type PodMetricsWatch,
  type PodSample,
} from '@dltech/atlas-protocol'

import type { PodOps } from '../../host/pod-ops'
import type { PodMetricsBus } from '../pod-metrics-bus'
import { PodMetricsRelay } from '../pod-metrics-relay'
import { until } from '../../stream/__tests__/until'

const sample = (at: number): PodSample => ({
  at,
  cpuPercent: 12.5,
  ramBytes: 1024,
  ramLimitBytes: 2048,
  throttled: false,
  oomKills: 0,
})

const frameOf = (payload: PodSample): EventFrame => ({
  kind: 'event',
  event: { type: 'metrics.sample', sample: payload },
})

const outcomeOf = (value: PodSample[] | null): PodCallOutcome =>
  value === null
    ? { state: 'unavailable', reason: ELiveOpFailure.Asleep }
    : {
        state: 'ok',
        result: { status: ECallStatus.Ok, op: 'metrics.subscribe', value: { samples: value } },
      }

const busOf = () => {
  const watchListeners = new Set<(request: PodMetricsWatch) => void>()
  const frames: { sessionId: string; frame: PodMetricsFrame }[] = []
  const bus: Pick<PodMetricsBus, 'onWatch' | 'publish'> & {
    requestWatch(request: PodMetricsWatch): Promise<void>
  } = {
    onWatch(listener) {
      watchListeners.add(listener)
      return () => {
        watchListeners.delete(listener)
      }
    },
    async publish(args) {
      frames.push(args)
    },
    async requestWatch(request) {
      for (const listener of [...watchListeners]) listener(request)
    },
  }
  return { bus, frames }
}

const operationsOf = (args: {
  held: boolean
  backlog?: PodSample[] | null
  subscribeFailure?: string | undefined
}) => {
  const calls: string[] = []
  const state: {
    listener: ((frame: EventFrame) => void) | undefined
    close: (() => void) | undefined
    dispose: ReturnType<typeof vi.fn>
  } = { listener: undefined, close: undefined, dispose: vi.fn() }
  const invoke = vi.fn(async (input: { op: { op: string } }) => {
    calls.push(input.op.op)
    if (input.op.op === 'metrics.unsubscribe')
      return {
        state: 'ok',
        result: { status: ECallStatus.Ok, op: 'metrics.unsubscribe', value: null },
      }
    if (args.subscribeFailure !== undefined)
      return {
        state: 'ok',
        result: {
          status: ECallStatus.Failed,
          op: 'metrics.subscribe',
          error: { code: ECallFailure.Internal, message: args.subscribeFailure },
        },
      }
    return outcomeOf(args.backlog === undefined ? [] : args.backlog)
  })
  const events = vi.fn((input: { listener: (frame: EventFrame) => void; onClose?: () => void }) => {
    if (!args.held) return null
    state.listener = input.listener
    state.close = input.onClose
    return state.dispose
  })
  const ops = { events, invoke } as unknown as Pick<PodOps, 'events' | 'invoke'>
  return { ops, invoke, events, state, calls }
}

const relayOf = (args: {
  ops: Pick<PodOps, 'events' | 'invoke'>
  bus: Pick<PodMetricsBus, 'onWatch' | 'publish'>
}) => {
  const relay = new PodMetricsRelay(args)
  relay.onModuleInit()
  return relay
}

const watch = (
  bus: { requestWatch(request: PodMetricsWatch): Promise<void> },
  args: {
    sessionId?: string
    watcherId: string
    ttlMs: number
  },
) =>
  bus.requestWatch({
    sessionId: args.sessionId ?? 's1',
    watcherId: args.watcherId,
    ttlMs: args.ttlMs,
  })

describe('PodMetricsRelay', () => {
  it('ignores a watch request for a session this process does not hold', async () => {
    const { ops, invoke, events } = operationsOf({ held: false })
    const { bus, frames } = busOf()
    relayOf({ ops, bus })
    await watch(bus, { watcherId: 'w1', ttlMs: 30 })
    expect(events).toHaveBeenCalledTimes(1)
    expect(invoke).not.toHaveBeenCalled()
    expect(frames).toEqual([])
  })

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
