import { describe, expect, it } from 'bun:test'

import {
  AGENT37_DISK_SOURCE,
  DISK_ROW,
  type PodRow,
  RestartingPodSandbox,
  rowOf,
  sizingOf,
  startOf,
  until,
} from './pod-applied-size.fixtures'

describe('recording the pod disk', () => {
  it('records a resize that grew the disk only once the pod reports the bigger disk', async () => {
    const rows: Record<string, PodRow> = { 'pod-a': DISK_ROW }
    const { recorded, podSizing } = sizingOf(rows)
    const small = new RestartingPodSandbox([{ vcpus: 4, memoryGb: 16 }], 20)
    const first = await startOf({ sandbox: small, podSizing })
    await until(() => small.wakes >= 3)
    await first.stop()
    expect(recorded).toEqual([])

    const grown = new RestartingPodSandbox([{ vcpus: 4, memoryGb: 16 }], 30)
    const second = await startOf({ sandbox: grown, podSizing })
    await until(() => recorded.length > 0)
    await second.stop()
    expect(recorded).toContainEqual({ sessionId: 'pod-a', vcpus: 4, memoryGb: 16, generation: 1 })
  })

  it('records the disk an agent37 pod came up with when no row holds one', async () => {
    const rows: Record<string, PodRow> = { 'pod-a': rowOf() }
    const { recordedDisks, podSizing } = sizingOf(rows)
    const sandbox = new RestartingPodSandbox([{ vcpus: 2, memoryGb: 4 }], 80)
    const runtime = await startOf({ sandbox, podSizing })
    await until(() => recordedDisks.length > 0)
    await runtime.stop()

    expect(recordedDisks).toEqual([{ sessionId: 'pod-a', diskGb: 80 }])
  })

  it('records the disk it asked an agent37 pod for when the pod reports none of its own', async () => {
    const rows: Record<string, PodRow> = { 'pod-a': rowOf() }
    const { recordedDisks, podSizing } = sizingOf(rows)
    const sandbox = new RestartingPodSandbox([{ vcpus: 2, memoryGb: 4 }])
    const runtime = await startOf({ sandbox, podSizing, config: AGENT37_DISK_SOURCE })
    await until(() => recordedDisks.length > 0)
    await runtime.stop()

    expect(recordedDisks).toEqual([{ sessionId: 'pod-a', diskGb: 40 }])
  })

  it('leaves a vercel pod alone, whose endpoint reports no disk', async () => {
    const rows: Record<string, PodRow> = { 'pod-a': rowOf() }
    const { recordedDisks, podSizing } = sizingOf(rows)
    const sandbox = new RestartingPodSandbox([{ vcpus: 2, memoryGb: 4 }])
    const runtime = await startOf({ sandbox, podSizing })
    await until(() => sandbox.wakes >= 3)
    await runtime.stop()

    expect(recordedDisks).toEqual([])
  })

  it('leaves a disk a resize asked for alone when the pod still reports the old one', async () => {
    const rows: Record<string, PodRow> = { 'pod-a': DISK_ROW }
    const { recordedDisks, podSizing } = sizingOf(rows)
    const sandbox = new RestartingPodSandbox([{ vcpus: 4, memoryGb: 16 }], 20)
    const runtime = await startOf({ sandbox, podSizing })
    await until(() => sandbox.wakes >= 3)
    await runtime.stop()

    expect(recordedDisks).toEqual([])
    expect(rows['pod-a']?.podDesiredDiskGb).toBe(30)
  })
})
