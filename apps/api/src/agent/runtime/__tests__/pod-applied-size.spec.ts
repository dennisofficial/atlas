import { describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'

import {
  type PodRow,
  RestartingPodSandbox,
  build,
  rowOf,
  sizingOf,
  until,
} from './pod-applied-size.fixtures'

describe('recording the applied pod size', () => {
  it('records the size a resize wrote while the runtime was already built', async () => {
    const rows: Record<string, PodRow> = { 'pod-a': rowOf() }
    const { recorded, podSizing } = sizingOf(rows)
    const sandbox = new RestartingPodSandbox([
      { vcpus: 4, memoryGb: 8 },
      { vcpus: 2, memoryGb: 4 },
    ])
    const runtime = await build({ sandbox, podSizing })({
      sessionId: 'pod-a',
      podSessionId: 'pod-a',
      threadId: toThreadId('t-pod-a'),
      epoch: 1,
      signal: new AbortController().signal,
    })
    // the resize lands after the runtime is built: 2 vCPU as generation 1 on the pod row
    rows['pod-a'] = rowOf({ podDesiredVcpus: 2, podDesiredMemoryGb: 4, podSizeGeneration: 1 })
    await until(() => recorded.length > 0)
    await runtime.stop()

    expect(sandbox.reported.slice(0, 2)).toEqual([
      { vcpus: 4, memoryGb: 8 },
      { vcpus: 2, memoryGb: 4 },
    ])
    expect(recorded).toContainEqual({ sessionId: 'pod-a', vcpus: 2, memoryGb: 4, generation: 1 })
  })

  it('records the observed size of a pod that was never resized', async () => {
    const rows: Record<string, PodRow> = { 'pod-a': rowOf() }
    const { recorded, podSizing } = sizingOf(rows)
    const sandbox = new RestartingPodSandbox([{ vcpus: 4, memoryGb: 8 }])
    const runtime = await build({ sandbox, podSizing })({
      sessionId: 'pod-a',
      podSessionId: 'pod-a',
      threadId: toThreadId('t-pod-a'),
      epoch: 1,
      signal: new AbortController().signal,
    })
    await until(() => recorded.length > 0)
    await runtime.stop()

    expect(recorded[0]).toEqual({ sessionId: 'pod-a', vcpus: 4, memoryGb: 8, generation: 0 })
  })

  it('records on the pod row a sub-agent session shares', async () => {
    const rows: Record<string, PodRow> = {
      'pod-a': rowOf({ podDesiredVcpus: 2, podDesiredMemoryGb: 4, podSizeGeneration: 1 }),
    }
    const { recorded, podSizing } = sizingOf(rows)
    const sandbox = new RestartingPodSandbox([{ vcpus: 2, memoryGb: 4 }])
    const runtime = await build({ sandbox, podSizing })({
      sessionId: 'child-a',
      podSessionId: 'pod-a',
      threadId: toThreadId('t-child-a'),
      epoch: 1,
      signal: new AbortController().signal,
    })
    await until(() => recorded.length > 0)
    await runtime.stop()

    expect(recorded[0]).toEqual({ sessionId: 'pod-a', vcpus: 2, memoryGb: 4, generation: 1 })
  })

  it('records nothing when the sandbox came back at another size', async () => {
    const rows: Record<string, PodRow> = {
      'pod-a': rowOf({ podDesiredVcpus: 4, podDesiredMemoryGb: 8, podSizeGeneration: 2 }),
    }
    const { recorded, podSizing } = sizingOf(rows)
    const sandbox = new RestartingPodSandbox([{ vcpus: 2, memoryGb: 4 }])
    const runtime = await build({ sandbox, podSizing })({
      sessionId: 'pod-a',
      podSessionId: 'pod-a',
      threadId: toThreadId('t-pod-a'),
      epoch: 1,
      signal: new AbortController().signal,
    })
    await until(() => sandbox.wakes >= 3)
    await runtime.stop()

    expect(recorded).toEqual([])
  })

  it('records nothing when the sandbox came back at the cpu count but another memory', async () => {
    const rows: Record<string, PodRow> = {
      'pod-a': rowOf({ podDesiredVcpus: 4, podDesiredMemoryGb: 32, podSizeGeneration: 2 }),
    }
    const { recorded, podSizing } = sizingOf(rows)
    const sandbox = new RestartingPodSandbox([{ vcpus: 4, memoryGb: 8 }])
    const runtime = await build({ sandbox, podSizing })({
      sessionId: 'pod-a',
      podSessionId: 'pod-a',
      threadId: toThreadId('t-pod-a'),
      epoch: 1,
      signal: new AbortController().signal,
    })
    await until(() => sandbox.wakes >= 3)
    await runtime.stop()

    expect(recorded).toEqual([])
  })
})
