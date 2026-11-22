import { describe, expect, it } from 'bun:test'

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EOomScope } from '@dltech/atlas-core'
import type { DaemonEvent, MetricsSampleEvent } from '@dltech/atlas-protocol'
import type { CallContext } from '@dltech/atlas-protocol/engine'

import { METRICS_INTERVAL_ENV, metricsGroup } from '../../metrics'
import { OOM_JOURNAL_FILE } from '../journal'

const INTERVAL_MS = 20
const COMMAND_LIMIT_BYTES = 2_684_354_560

const rig = (root: string) => {
  const events: DaemonEvent[] = []
  const group = metricsGroup({
    env: {
      ATLAS_DAEMON_CGROUP_ROOT: root,
      ATLAS_DAEMON_PROC_ROOT: join(root, 'proc'),
      ATLAS_WORKLOAD_CGROUP: join(root, 'atlas-work'),
      [METRICS_INTERVAL_ENV]: String(INTERVAL_MS),
    },
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
    call: async (op: { op: 'metrics.subscribe' } | { op: 'metrics.unsubscribe' }) => {
      const registered = group.ops.find((candidate) => candidate.op === op.op)
      if (registered === undefined) throw new Error(`no op ${op.op}`)
      return await registered.run({ op, ctx })
    },
    samples: () =>
      events.filter((event): event is MetricsSampleEvent => event.type === 'metrics.sample'),
    stop: async () => {
      await group.stop?.()
    },
  }
}

const writeCounters = async (root: string, usageUsec: number): Promise<void> => {
  await writeFile(join(root, 'cpu.stat'), `usage_usec ${usageUsec}\nthrottled_usec 0\n`)
  await writeFile(join(root, 'cpu.max'), '400000 100000\n')
  await writeFile(join(root, 'memory.current'), '536870912\n')
  await writeFile(join(root, 'memory.max'), '4294967296\n')
  await writeFile(join(root, 'memory.events'), 'oom 0\noom_kill 0\n')
}

const waitUntil = async (ready: () => boolean, ms = 2_000): Promise<void> => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (ready()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('no sample arrived in time')
}

describe('the oom counts in the pod metrics sample', () => {
  it('carries the journal total and the command memory ceiling', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atlas-oom-metrics-'))
    try {
      const workGroup = join(root, 'atlas-work')
      await mkdir(workGroup, { recursive: true })
      await writeFile(join(workGroup, 'memory.max'), `${COMMAND_LIMIT_BYTES}\n`)
      await writeFile(
        join(root, OOM_JOURNAL_FILE),
        JSON.stringify({
          total: 3,
          incidents: [
            {
              incidentId: 'incident-1',
              at: 1_700_000_000_000,
              scope: EOomScope.Command,
              command: 'cargo test',
              processes: 2,
              memory: { commandLimitBytes: COMMAND_LIMIT_BYTES, podBytes: 4 * 1024 ** 3 },
            },
          ],
        }),
      )
      await writeCounters(root, 1_000_000)
      const watch = rig(root)
      try {
        await watch.call({ op: 'metrics.subscribe' })
        await writeCounters(root, 2_000_000)
        await waitUntil(() => watch.samples().length > 0)
        const sample = watch.samples().at(-1)?.sample
        expect(sample?.oomEvents).toBe(3)
        expect(sample?.commandRamLimitBytes).toBe(COMMAND_LIMIT_BYTES)
      } finally {
        await watch.stop()
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('omits the command ceiling when the work group has no readable limit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atlas-oom-metrics-'))
    try {
      await writeCounters(root, 1_000_000)
      const watch = rig(root)
      try {
        await watch.call({ op: 'metrics.subscribe' })
        await writeCounters(root, 2_000_000)
        await waitUntil(() => watch.samples().length > 0)
        const sample = watch.samples().at(-1)?.sample
        expect(sample?.oomEvents).toBe(0)
        expect(sample?.commandRamLimitBytes).toBeUndefined()
      } finally {
        await watch.stop()
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
