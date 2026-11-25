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

  it('keeps the wait a whenIdle payload resumes on', () => {
    expect(
      podResizePayloadSchema.parse({
        sessionId: 's-1',
        generation: 1,
        vcpus: 8,
        memoryGb: 64,
        whenIdle: true,
        waitedSince: '2026-11-25T11:00:00.000Z',
      }),
    ).toEqual({
      sessionId: 's-1',
      generation: 1,
      vcpus: 8,
      memoryGb: 64,
      whenIdle: true,
      waitedSince: '2026-11-25T11:00:00.000Z',
    })
  })
})

describe('podResizeIdempotencyKey', () => {
  it('keys a task by the generation that asked for it', () => {
    expect(
      podResizeIdempotencyKey({ sessionId: 's-1', generation: 2, vcpus: 4, memoryGb: 16 }),
    ).toBe('pod-resize:s-1:2')
  })

  it('keys a resumed task by the wait it resumes', () => {
    expect(
      podResizeIdempotencyKey({
        sessionId: 's-1',
        generation: 2,
        vcpus: 4,
        memoryGb: 16,
        whenIdle: true,
        waitedSince: '2026-11-25T11:00:00.000Z',
      }),
    ).toBe('pod-resize:s-1:2:idle:2026-11-25T11:00:00.000Z')
  })
})
