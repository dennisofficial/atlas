import { afterAll, describe, expect, it } from 'bun:test'

import type { PodMetricsFrame, PodMetricsWatch } from '@dltech/atlas-protocol'

import { until } from '../../stream/__tests__/until'
import { createPodMetricsBus, type PodMetricsBus } from '../pod-metrics-bus'

const url = process.env.ATLAS_TEST_REDIS_URL ?? 'redis://127.0.0.1:55442'

describe.skipIf(process.env.ATLAS_TEST_REDIS_URL === undefined)('redis pod metrics bus', () => {
  const buses: PodMetricsBus[] = []

  afterAll(async () => {
    for (const bus of buses.splice(0)) await bus.close()
  })

  const busOf = (): PodMetricsBus => {
    const bus = createPodMetricsBus({ url })
    buses.push(bus)
    return bus
  }

  it('carries a watch request and frames between two instances', async () => {
    const holder = busOf()
    const watcher = busOf()
    const sessionId = `ses-${crypto.randomUUID()}`
    const requests: PodMetricsWatch[] = []
    holder.onWatch((request) => requests.push(request))
    const frames: PodMetricsFrame[] = []
    const unsubscribe = await watcher.subscribe({
      sessionId,
      listener: (frame) => frames.push(frame),
    })
    await watcher.requestWatch({ sessionId, watcherId: 'w-1', ttlMs: 15_000 })
    await until(() => requests.some((request) => request.sessionId === sessionId), 'watch request')
    const sample = {
      at: 1,
      cpuPercent: 5,
      ramBytes: 10,
      ramLimitBytes: 100,
      throttled: false,
      oomKills: 0,
    }
    await holder.publish({ sessionId, frame: { type: 'sample', sample } })
    await until(() => frames.length === 1, 'relayed sample')
    expect(frames[0]).toEqual({ type: 'sample', sample })
    await unsubscribe()
    await holder.publish({ sessionId, frame: { type: 'sample', sample: { ...sample, at: 2 } } })
    await Bun.sleep(100)
    expect(frames).toHaveLength(1)
  })
})
