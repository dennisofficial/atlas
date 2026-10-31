import { describe, expect, it } from 'bun:test'

import {
  EPodResizeApplies,
  EPodState,
  podResizeInputSchema,
  podResizeReplySchema,
  podStatusSchema,
} from '../web'

describe('pod resources wire', () => {
  it('accepts a status with and without resources', () => {
    const base = { state: EPodState.Running, steps: [] }
    const resources = {
      sandboxId: 'sbx',
      region: 'iad1',
      vcpus: 2,
      memoryMb: 4096,
      pendingVcpus: 4,
    }

    expect(podStatusSchema.safeParse(base).success).toBe(true)
    expect(podStatusSchema.safeParse({ ...base, resources }).success).toBe(true)
    expect(podStatusSchema.safeParse({ ...base, resources: { region: 'iad1' } }).success).toBe(
      false,
    )
  })

  it('accepts an optional read revision and rejects invalid revisions', () => {
    const status = { state: EPodState.Running, steps: [] }
    expect(podStatusSchema.parse(status)).toEqual(status)
    for (const rev of [0, 6]) {
      expect(podStatusSchema.parse({ ...status, rev })).toEqual({ ...status, rev })
    }
    for (const rev of [-1, 1.5, '6', null]) {
      expect(podStatusSchema.safeParse({ ...status, rev }).success).toBe(false)
    }
  })

  it('resizes only to the vCPU steps the project setting allows', () => {
    const parse = (vcpus: number) =>
      podResizeInputSchema.safeParse({ threadId: 't', vcpus }).success

    expect([2, 4, 6, 8].map(parse)).toEqual([true, true, true, true])
    expect([0, 1, 3, 10, 2.5].map(parse)).toEqual([false, false, false, false, false])
    expect(podResizeInputSchema.safeParse({ threadId: '', vcpus: 2 }).success).toBe(false)
    expect(podResizeInputSchema.safeParse({ threadId: 't', vcpus: 2, extra: 1 }).success).toBe(
      false,
    )
  })

  it('replies with the size and when it applies', () => {
    expect(
      podResizeReplySchema.safeParse({
        vcpus: 4,
        appliesAt: EPodResizeApplies.Live,
      }).success,
    ).toBe(true)
    expect(podResizeReplySchema.safeParse({ vcpus: 4, appliesAt: 'restart' }).success).toBe(false)
  })
})
