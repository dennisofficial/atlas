import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import type { DaemonEvent } from '@dltech/atlas-protocol'
import type { CallContext } from '@dltech/atlas-protocol/engine'

import { METRICS_DISK_ROOT_ENV, readFirstPodDisk, readPodDisk } from '../cgroup'
import { METRICS_INTERVAL_ENV, metricsGroup } from '..'

const withRoot = async (run: (root: string) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-disk-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('readPodDisk', () => {
  it('reads the filesystem of the pod volume with statfs', async () => {
    await withRoot(async (root) => {
      const disk = readPodDisk({ root })
      expect(disk).not.toBeNull()
      expect(disk?.diskLimitBytes).toBeGreaterThan(0)
      expect(disk?.diskUsedBytes).toBeGreaterThanOrEqual(0)
      expect(disk?.diskLimitBytes).toBeGreaterThan(disk?.diskUsedBytes ?? 0)
    })
  })

  it('reports no disk figures for a path that does not exist', () => {
    expect(readPodDisk({ root: join(tmpdir(), 'atlas-missing-disk-root') })).toBeNull()
  })
})

describe('readFirstPodDisk', () => {
  it('reads the pod volume first and falls back when it is not mounted', async () => {
    await withRoot(async (root) => {
      const missing = join(tmpdir(), 'atlas-missing-volume')
      expect(readFirstPodDisk({ roots: [missing, root] })).toEqual(readPodDisk({ root }))
      expect(readFirstPodDisk({ roots: [missing] })).toBeNull()
    })
  })
})

const countersOf = async (root: string, usageUsec: number): Promise<void> => {
  await writeFile(join(root, 'cpu.stat'), `usage_usec ${usageUsec}\nthrottled_usec 0\n`)
  await writeFile(join(root, 'memory.current'), `${512 * 1024 ** 2}\n`)
  await writeFile(join(root, 'memory.max'), `${4 * 1024 ** 3}\n`)
}

describe('the daemon sample carries disk', () => {
  it('puts the volume figures on every sample', async () => {
    await withRoot(async (root) => {
      await countersOf(root, 1_000_000)
      const events: DaemonEvent[] = []
      const group = metricsGroup({
        env: {
          ATLAS_DAEMON_CGROUP_ROOT: root,
          ATLAS_DAEMON_PROC_ROOT: join(root, 'proc'),
          [METRICS_DISK_ROOT_ENV]: root,
          [METRICS_INTERVAL_ENV]: '20',
        },
        home: root,
      })({ publish: (event) => events.push(event) })
      const ctx: CallContext = {
        key: 'k',
        signal: new AbortController().signal,
        output: () => undefined,
        publish: () => undefined,
      }
      try {
        const subscribe = group.ops.find((candidate) => candidate.op === 'metrics.subscribe')
        await subscribe?.run({ op: { op: 'metrics.subscribe' }, ctx })
        await countersOf(root, 2_000_000)
        const deadline = Date.now() + 2_000
        while (events.length === 0 && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 5))
        }
        const sample = events.find((event) => event.type === 'metrics.sample')?.sample
        expect(sample?.diskLimitBytes).toBeGreaterThan(0)
        expect(sample?.diskUsedBytes).toBeGreaterThanOrEqual(0)
      } finally {
        await group.stop?.()
      }
    })
  })
})
