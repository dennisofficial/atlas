import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import type { CallOp, DaemonEvent, MetricsSampleEvent } from '@dltech/atlas-protocol'
import type { CallContext } from '@dltech/atlas-protocol/engine'

import { METRICS_INTERVAL_ENV, metricsGroup } from '..'

const INTERVAL_MS = 20

type Cgroup = {
  usageUsec: number
  throttledUsec: number
  memoryBytes: number
  memoryMax: string
  oomKills: number
}

const cgroupOf = (over: Partial<Cgroup> = {}): Cgroup => ({
  usageUsec: 1_000_000,
  throttledUsec: 0,
  memoryBytes: 512 * 1024 ** 2,
  memoryMax: String(4 * 1024 ** 3),
  oomKills: 0,
  ...over,
})

const writeCgroup = async (root: string, state: Cgroup): Promise<void> => {
  await writeFile(
    join(root, 'cpu.stat'),
    `usage_usec ${state.usageUsec}\nthrottled_usec ${state.throttledUsec}\n`,
  )
  await writeFile(join(root, 'memory.current'), `${state.memoryBytes}\n`)
  await writeFile(join(root, 'memory.max'), `${state.memoryMax}\n`)
  await writeFile(
    join(root, 'memory.events'),
    `low 0\nhigh 0\nmax 0\noom ${state.oomKills}\noom_kill ${state.oomKills}\n`,
  )
  await writeFile(join(root, 'cpu.max'), '400000 100000\n')
}

const rig = (root: string) => {
  const events: DaemonEvent[] = []
  const group = metricsGroup({
    env: { ATLAS_DAEMON_CGROUP_ROOT: root, [METRICS_INTERVAL_ENV]: String(INTERVAL_MS) },
    home: root,
  })({ publish: (event) => events.push(event) })
  const ctx: CallContext = {
    key: 'k',
    signal: new AbortController().signal,
    output: () => undefined,
    publish: () => undefined,
  }
  return {
    group,
    events,
    samples: () =>
      events.filter((event): event is MetricsSampleEvent => event.type === 'metrics.sample'),
    call: async (op: CallOp) => {
      const registered = group.ops.find((candidate) => candidate.op === op.op)
      if (registered === undefined) throw new Error(`no op ${op.op}`)
      return await registered.run({ op, ctx })
    },
    stop: async () => {
      await group.stop?.()
    },
  }
}

const waitUntil = async (ready: () => boolean, ms = 2_000): Promise<void> => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (ready()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('no sample arrived in time')
}

describe('the daemon metrics op', () => {
  it('answers with an empty backlog and streams samples while subscribed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atlas-metrics-'))
    await writeCgroup(root, cgroupOf())
    const watch = rig(root)
    try {
      const backlog = await watch.call({ op: 'metrics.subscribe' })
      expect(backlog).toEqual({ samples: [] })
      await writeCgroup(root, cgroupOf({ usageUsec: 1_120_000, memoryBytes: 768 * 1024 ** 2 }))
      await waitUntil(() => watch.samples().length > 0)
      const sample = watch.samples()[0]?.sample
      expect(sample?.ramBytes).toBe(768 * 1024 ** 2)
      expect(sample?.ramLimitBytes).toBe(4 * 1024 ** 3)
      expect(sample?.cpuPercent).toBeGreaterThan(0)
    } finally {
      await watch.stop()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports the throttling, oom kills and a provisioned cpu count from the cgroup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atlas-metrics-'))
    await writeCgroup(root, cgroupOf({ usageUsec: 0 }))
    const watch = rig(root)
    try {
      await watch.call({ op: 'metrics.subscribe' })
      await writeCgroup(root, cgroupOf({ usageUsec: 6_000_000, throttledUsec: 5_000, oomKills: 1 }))
      await waitUntil(() => watch.samples().length > 0)
      const sample = watch.samples()[0]?.sample
      expect(sample?.throttled).toBe(true)
      expect(sample?.oomKills).toBe(1)
      expect(sample?.cpuPercent).toBeGreaterThan(50)
    } finally {
      await watch.stop()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps one sampler for every subscriber and stops when the last one leaves', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atlas-metrics-'))
    await writeCgroup(root, cgroupOf())
    const watch = rig(root)
    try {
      await watch.call({ op: 'metrics.subscribe' })
      await watch.call({ op: 'metrics.subscribe' })
      await writeCgroup(root, cgroupOf({ usageUsec: 2_000_000 }))
      await waitUntil(() => watch.samples().length > 0)
      const publisher = watch.samples()[0]?.sample
      expect(watch.samples().filter((event) => event.sample.at === publisher?.at)).toHaveLength(1)
      await watch.call({ op: 'metrics.unsubscribe' })
      await watch.call({ op: 'metrics.unsubscribe' })
      const seen = watch.samples().length
      await writeCgroup(root, cgroupOf({ usageUsec: 5_000_000 }))
      await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS * 4))
      expect(watch.samples()).toHaveLength(seen)
    } finally {
      await watch.stop()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('answers a resubscriber with the samples kept in the ring', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atlas-metrics-'))
    await writeCgroup(root, cgroupOf())
    const watch = rig(root)
    try {
      await watch.call({ op: 'metrics.subscribe' })
      await writeCgroup(root, cgroupOf({ usageUsec: 2_000_000 }))
      await waitUntil(() => watch.samples().length > 0)
      await watch.call({ op: 'metrics.unsubscribe' })
      const backlog = (await watch.call({ op: 'metrics.subscribe' })) as {
        samples: readonly { at: number }[]
      }
      expect(backlog.samples.length).toBeGreaterThan(0)
      await watch.call({ op: 'metrics.unsubscribe' })
    } finally {
      await watch.stop()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('answers unavailable when the pod has no readable cgroup counters', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atlas-metrics-'))
    const watch = rig(root)
    try {
      await expect(watch.call({ op: 'metrics.subscribe' })).rejects.toThrow('not readable')
    } finally {
      await watch.stop()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('stops sampling when the pod connection goes away', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atlas-metrics-'))
    await writeCgroup(root, cgroupOf())
    const watch = rig(root)
    try {
      await watch.call({ op: 'metrics.subscribe' })
      watch.group.onDisconnect?.()
      expect(watch.samples()).toHaveLength(0)
      await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS * 4))
      expect(watch.samples()).toHaveLength(0)
    } finally {
      await watch.stop()
      await rm(root, { recursive: true, force: true })
    }
  })
})
