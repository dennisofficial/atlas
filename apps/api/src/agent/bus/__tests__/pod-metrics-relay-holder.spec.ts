import { describe, expect, it, vi } from 'bun:test'
import type { LogPort } from '@dltech/atlas-observability'

import { until } from '../../stream/__tests__/until'
import { busOf, operationsOf, relayOf, sample, watch } from './pod-metrics-relay.fixtures'

describe('PodMetricsRelay holder', () => {
  it('asks for a holder before it relays, and keeps asking while the watcher renews', async () => {
    const { ops, hold, waitForHolder, events } = operationsOf({ held: true, backlog: [] })
    const { bus, frames } = busOf()
    relayOf({ ops, bus })
    await watch(bus, { watcherId: 'w1', ttlMs: 30 })
    await until(() => frames.length === 1, 'the backlog')
    expect(hold).toHaveBeenCalledWith({ sessionId: 's1', ttlMs: 30 })
    expect(waitForHolder).toHaveBeenCalledTimes(1)
    expect(events).toHaveBeenCalledTimes(1)
    expect(hold.mock.invocationCallOrder[0]).toBeLessThan(
      waitForHolder.mock.invocationCallOrder[0] ?? 0,
    )
    await watch(bus, { watcherId: 'w1', ttlMs: 30 })
    expect(hold).toHaveBeenCalledTimes(2)
  })

  it('relays on a later request when the first one cannot find a holder yet', async () => {
    const { ops, holders, waitForHolder } = operationsOf({
      held: true,
      holder: false,
      backlog: [sample(1_000)],
    })
    const { bus, frames } = busOf()
    relayOf({ ops, bus })
    await watch(bus, { watcherId: 'w1', ttlMs: 500 })
    await until(() => waitForHolder.mock.calls.length === 1, 'the holder wait')
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    expect(frames).toEqual([])
    holders.value = true
    await watch(bus, { watcherId: 'w1', ttlMs: 500 })
    await until(() => frames.length === 1, 'the backlog')
    expect(frames).toEqual([
      { sessionId: 's1', frame: { type: 'samples', samples: [sample(1_000)] } },
    ])
  })

  it('warns instead of claiming failure when it cannot attach to the pod', async () => {
    const { ops } = operationsOf({ held: false, holder: true })
    const { bus, frames } = busOf()
    const warn = vi.fn()
    relayOf({ ops, bus, log: { warn } as unknown as LogPort })
    await watch(bus, { watcherId: 'w1', ttlMs: 30 })
    await until(() => warn.mock.calls.length === 1, 'the warning')
    expect(frames).toEqual([])
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      source: 'bus.pod-metrics',
      data: { reason: 'no host holds this session yet' },
    })
  })
})
