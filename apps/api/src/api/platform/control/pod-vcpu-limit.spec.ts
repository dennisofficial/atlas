import { describe, expect, it } from 'bun:test'
import { BadRequestException } from '@nestjs/common'
import { AGENT37_POD_SHAPES, POD_SHAPE_ENTERPRISE_REASON } from '@dltech/atlas-core'
import { ESandboxProvider } from '@dltech/atlas-protocol'

import { assertWithinShapeLimit, podSizingLimitOf } from './pod-vcpu-limit'

describe('podSizingLimitOf', () => {
  it('offers an Agent37 pod its five vm shapes and nothing it cannot run', () => {
    const agent37 = podSizingLimitOf({ sandboxProvider: ESandboxProvider.Agent37 })
    expect(agent37.cap).toBe(8)
    expect(agent37.offered).toEqual([...AGENT37_POD_SHAPES])
    expect(agent37.unavailable).toEqual([])
  })

  it('offers a Vercel pod 2 GB a vCPU up to 8 and names the plan past it', () => {
    const vercel = podSizingLimitOf({ sandboxProvider: ESandboxProvider.Vercel })
    expect(vercel.offered.map((shape) => shape.vcpus)).toEqual([1, 2, 4, 6, 8])
    expect(vercel.offered.at(-1)).toEqual({ vcpus: 8, memoryGb: 16 })
    expect(vercel.unavailable[0]?.reason).toBe(POD_SHAPE_ENTERPRISE_REASON)
  })
})

describe('assertWithinShapeLimit', () => {
  const vercel = podSizingLimitOf({ sandboxProvider: ESandboxProvider.Vercel })
  const agent37 = podSizingLimitOf({ sandboxProvider: ESandboxProvider.Agent37 })

  it('accepts 8 vCPU and 16 GB on a Vercel pod', () => {
    expect(() =>
      assertWithinShapeLimit({ shape: { vcpus: 8, memoryGb: 16 }, sizing: vercel }),
    ).not.toThrow()
  })

  it('refuses 16 vCPU on a Vercel pod with the cap', () => {
    expect(() =>
      assertWithinShapeLimit({ shape: { vcpus: 16, memoryGb: 32 }, sizing: vercel }),
    ).toThrow(/exceeds the 8 vCPU cap/)
  })

  it('accepts the 4 vCPU, 32 GB shape an Agent37 pod can grow into', () => {
    expect(() =>
      assertWithinShapeLimit({ shape: { vcpus: 4, memoryGb: 32 }, sizing: agent37 }),
    ).not.toThrow()
  })

  it('refuses 4 vCPU with 12 GB on an Agent37 pod, naming the memory it runs at', () => {
    expect(() =>
      assertWithinShapeLimit({ shape: { vcpus: 4, memoryGb: 12 }, sizing: agent37 }),
    ).toThrow(/runs at 8 GB or 16 GB or 32 GB/)
  })

  it('refuses 8 vCPU with 16 GB on an Agent37 pod rather than infer 2 GB a vCPU', () => {
    expect(() =>
      assertWithinShapeLimit({ shape: { vcpus: 8, memoryGb: 16 }, sizing: agent37 }),
    ).toThrow(/64 GB/)
  })

  it('refuses 3 vCPU on an Agent37 pod', () => {
    expect(() =>
      assertWithinShapeLimit({ shape: { vcpus: 3, memoryGb: 6 }, sizing: agent37 }),
    ).toThrow(/not a size this sandbox runs at/)
  })

  it('refuses 16 vCPU on an Agent37 pod with the cap', () => {
    expect(() =>
      assertWithinShapeLimit({ shape: { vcpus: 16, memoryGb: 32 }, sizing: agent37 }),
    ).toThrow(BadRequestException)
  })
})
