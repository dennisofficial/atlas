import { describe, expect, it } from 'bun:test'

import {
  AGENT37_SANDBOX_PROVIDER,
  AGENT37_POD_SHAPES,
  PLATFORM_POD_VCPU_CAP,
  POD_SHAPE_ENTERPRISE_REASON,
  podShapeAllowed,
  podShapeEquals,
  podShapeOfVcpus,
  podShapeLabel,
  podShapeWhyUnavailable,
  podSizingOf,
  VERCEL_POD_SHAPES,
} from '../pod-shapes'

const agent37 = podSizingOf({ sandboxProvider: AGENT37_SANDBOX_PROVIDER })
const vercel = podSizingOf({ sandboxProvider: 'vercel' })

describe('podShapeLabel', () => {
  it('separates the CPU and memory with plain punctuation', () => {
    const label = podShapeLabel({ vcpus: 4, memoryGb: 16 })
    expect(label).toBe('4 vCPU, 16 GB')
    expect(label).not.toContain('\u00b7')
  })
})

describe('podSizingOf', () => {
  it('offers an Agent37 pod the five vm shapes, including three at 4 vCPU', () => {
    expect(agent37.offered).toEqual([...AGENT37_POD_SHAPES])
    expect(agent37.offered.filter((shape) => shape.vcpus === 4)).toEqual([
      { vcpus: 4, memoryGb: 8 },
      { vcpus: 4, memoryGb: 16 },
      { vcpus: 4, memoryGb: 32 },
    ])
    expect(agent37.unavailable).toEqual([])
  })

  it('never offers an Agent37 pod 64 GB of memory on more than 8 vCPU', () => {
    expect(agent37.offered.map((shape) => shape.memoryGb)).toEqual([4, 8, 16, 32, 64])
  })

  it('offers a Vercel pod 2 GB a vCPU up to the platform cap and names the plan the rest needs', () => {
    expect(vercel.offered).toEqual(VERCEL_POD_SHAPES.filter((shape) => shape.vcpus <= 8))
    expect(vercel.offered[1]).toEqual({ vcpus: 2, memoryGb: 4 })
    expect(vercel.unavailable[0]).toEqual({
      shape: { vcpus: 10, memoryGb: 20 },
      reason: POD_SHAPE_ENTERPRISE_REASON,
    })
    expect(vercel.unavailable.at(-1)?.shape).toEqual({ vcpus: 32, memoryGb: 64 })
  })

  it('caps both providers at 8 vCPU', () => {
    expect(agent37.cap).toBe(PLATFORM_POD_VCPU_CAP)
    expect(vercel.cap).toBe(PLATFORM_POD_VCPU_CAP)
  })
})

describe('podShapeAllowed', () => {
  it('accepts the shape of a 4 vCPU, 32 GB Agent37 pod', () => {
    expect(podShapeAllowed({ shape: { vcpus: 4, memoryGb: 32 }, sizing: agent37 })).toBe(true)
  })

  it('refuses a 4 vCPU, 12 GB Agent37 pod, which is no vm shape', () => {
    expect(podShapeAllowed({ shape: { vcpus: 4, memoryGb: 12 }, sizing: agent37 })).toBe(false)
  })

  it('refuses 2 GB a vCPU for an Agent37 pod where Vercel would take it', () => {
    expect(podShapeAllowed({ shape: { vcpus: 4, memoryGb: 8 }, sizing: vercel })).toBe(true)
    expect(podShapeAllowed({ shape: { vcpus: 8, memoryGb: 16 }, sizing: agent37 })).toBe(false)
  })
})

describe('podShapeOfVcpus', () => {
  it('reads the one Agent37 shape at 8 vCPU and the first of three at 4', () => {
    expect(podShapeOfVcpus({ vcpus: 8, sizing: agent37 })).toEqual({ vcpus: 8, memoryGb: 64 })
    expect(podShapeOfVcpus({ vcpus: 4, sizing: agent37 })).toEqual({ vcpus: 4, memoryGb: 8 })
  })

  it('finds no shape at a vCPU count the provider does not run', () => {
    expect(podShapeOfVcpus({ vcpus: 3, sizing: agent37 })).toBeUndefined()
  })
})

describe('podShapeWhyUnavailable', () => {
  it('names the plan a Vercel size needs and stays quiet about an offered one', () => {
    expect(podShapeWhyUnavailable({ shape: { vcpus: 16, memoryGb: 32 }, sizing: vercel })).toBe(
      POD_SHAPE_ENTERPRISE_REASON,
    )
    expect(podShapeWhyUnavailable({ shape: { vcpus: 8, memoryGb: 16 }, sizing: vercel })).toBe(
      undefined,
    )
  })
})

describe('podShapeEquals', () => {
  it('compares both halves of the shape', () => {
    expect(
      podShapeEquals({ left: { vcpus: 4, memoryGb: 8 }, right: { vcpus: 4, memoryGb: 8 } }),
    ).toBe(true)
    expect(
      podShapeEquals({ left: { vcpus: 4, memoryGb: 8 }, right: { vcpus: 4, memoryGb: 16 } }),
    ).toBe(false)
  })
})
