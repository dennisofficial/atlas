import { describe, expect, it } from 'bun:test'

import { podResizeIdempotencyKey, podResizePayloadSchema } from './pod-resize.contract'

describe('podResizePayloadSchema', () => {
  it('carries the vCPU and memory shape a resize asked for', () => {
    expect(
      podResizePayloadSchema.parse({ sessionId: 's-1', generation: 1, vcpus: 4, memoryGb: 32 }),
    ).toEqual({ sessionId: 's-1', generation: 1, vcpus: 4, memoryGb: 32 })
  })

  it('refuses a payload that names only the vCPU count', () => {
    expect(
      podResizePayloadSchema.safeParse({ sessionId: 's-1', generation: 1, vcpus: 4 }).success,
    ).toBe(false)
  })

  it('keeps the wait and the retry count on a requeued payload', () => {
    expect(
      podResizePayloadSchema.parse({
        sessionId: 's-1',
        generation: 1,
        vcpus: 8,
        memoryGb: 64,
        whenIdle: true,
        waits: 2,
      }),
    ).toEqual({
      sessionId: 's-1',
      generation: 1,
      vcpus: 8,
      memoryGb: 64,
      whenIdle: true,
      waits: 2,
    })
  })
})

describe('podResizeIdempotencyKey', () => {
  it('keys a task by the generation that asked for it', () => {
    expect(
      podResizeIdempotencyKey({ sessionId: 's-1', generation: 2, vcpus: 4, memoryGb: 16 }),
    ).toBe('pod-resize:s-1:2:0')
  })
})
