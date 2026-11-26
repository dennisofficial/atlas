import { describe, expect, it } from 'bun:test'

import type { ControlSessionRow } from '../src/session-rows'
import { podStatusOf } from '../src/session-view-read'

const rowOf = (overrides: Partial<ControlSessionRow>): ControlSessionRow => ({
  sessionId: 'session-1',
  userId: 'user-1',
  projectId: null,
  title: null,
  mainThreadId: 'thread-1',
  createdAt: '2026-11-21T10:00:00.000Z',
  archivedAt: null,
  deletedAt: null,
  modelRef: 'anthropic/claude-haiku-4-5',
  modelEffort: 'medium',
  modelFast: false,
  sandboxProvider: 'agent37',
  credentialSource: 'platform',
  sandboxInstanceId: null,
  sandboxStatus: null,
  sandboxStatusAt: null,
  sandboxStatusReason: null,
  spawnedBySessionId: null,
  nested: true,
  podSessionId: null,
  podDesiredVcpus: null,
  podDesiredMemoryGb: null,
  podDesiredDiskGb: null,
  podSizeGeneration: 0,
  podActualVcpus: null,
  podActualMemoryGb: null,
  podAppliedGeneration: null,
  podResizeError: null,
  podWaitingSince: null,
  podParkedAt: null,
  podParkError: null,
  routineId: null,
  ...overrides,
})

describe('the actual pod shape in the session view', () => {
  it('reports nothing before a pod reports its cpu', () => {
    expect(podStatusOf(rowOf({}))).toEqual({
      phase: 'steady',
      sizing: expect.objectContaining({ cap: 8 }),
    })
  })

  it('reports the disk a pod row records, and none while no row records one', () => {
    expect(podStatusOf(rowOf({}))?.diskGb).toBeUndefined()
    expect(podStatusOf(rowOf({ podDesiredDiskGb: 40 }))?.diskGb).toBe(40)
  })

  it('reports a recorded disk whatever the provider', () => {
    expect(podStatusOf(rowOf({ sandboxProvider: 'vercel' }))?.diskGb).toBeUndefined()
    expect(podStatusOf(rowOf({ sandboxProvider: 'vercel', podDesiredDiskGb: 40 }))?.diskGb).toBe(40)
  })

  it('keeps the cpu of a pod recorded before its memory was stored, without inventing a memory', () => {
    const pod = podStatusOf(rowOf({ podActualVcpus: 4 }))

    expect(pod?.shape).toEqual({ vcpus: 4, memoryGb: null })
    expect(pod?.actualVcpus).toBe(4)
  })

  it('fills the memory of an agent37 pod whose cpu has one memory', () => {
    expect(podStatusOf(rowOf({ podActualVcpus: 8 }))?.shape).toEqual({ vcpus: 8, memoryGb: 64 })
    expect(podStatusOf(rowOf({ podActualVcpus: 2 }))?.shape).toEqual({ vcpus: 2, memoryGb: 4 })
  })

  it('fills the memory of a vercel pod from the two gigabytes a cpu gets', () => {
    expect(podStatusOf(rowOf({ sandboxProvider: 'vercel', podActualVcpus: 6 }))?.shape).toEqual({
      vcpus: 6,
      memoryGb: 12,
    })
  })

  it('reports the memory a pod recorded, over the one its cpu implies', () => {
    const pod = podStatusOf(rowOf({ podActualVcpus: 4, podActualMemoryGb: 32 }))

    expect(pod?.shape).toEqual({ vcpus: 4, memoryGb: 32 })
  })
})
