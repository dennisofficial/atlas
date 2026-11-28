import { describe, expect, it } from 'bun:test'

import {
  AGENT37_POD_SHAPES,
  podShapeKey,
  podShapeLabel,
  samePodShape,
  vercelPodShapesOf,
} from '../pod-shapes'

describe('agent37 pod shapes', () => {
  it('lists the five shapes the provider sells, identified by both values', () => {
    expect(AGENT37_POD_SHAPES).toEqual([
      { vcpus: 2, memoryGb: 4 },
      { vcpus: 4, memoryGb: 8 },
      { vcpus: 4, memoryGb: 16 },
      { vcpus: 4, memoryGb: 32 },
      { vcpus: 8, memoryGb: 64 },
    ])
    expect(new Set(AGENT37_POD_SHAPES.map(podShapeKey)).size).toBe(AGENT37_POD_SHAPES.length)
  })
})

describe('vercel pod shapes', () => {
  it('offers one vCPU or an even count up to the plan cap', () => {
    expect(vercelPodShapesOf({ maxVcpus: 8 }).map((shape) => shape.vcpus)).toEqual([1, 2, 4, 6, 8])
    expect(vercelPodShapesOf({ maxVcpus: 32 }).map((shape) => shape.vcpus)).toEqual([
      1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32,
    ])
  })

  it('keeps two GB of RAM per vCPU', () => {
    expect(
      vercelPodShapesOf({ maxVcpus: 8 }).every((shape) => shape.memoryGb === shape.vcpus * 2),
    ).toBe(true)
  })
})

describe('pod shape labels', () => {
  it('names both values, since several sizes share a vCPU count', () => {
    expect(podShapeLabel({ vcpus: 4, memoryGb: 16 })).toBe('4 vCPU, 16 GB')
    expect(podShapeLabel({ vcpus: 4, memoryGb: 8 })).toBe('4 vCPU, 8 GB')
  })

  it('tells two shapes with the same vCPU count apart', () => {
    expect(podShapeKey({ vcpus: 4, memoryGb: 8 })).not.toBe(podShapeKey({ vcpus: 4, memoryGb: 16 }))
    expect(samePodShape({ a: { vcpus: 4, memoryGb: 8 }, b: { vcpus: 4, memoryGb: 8 } })).toBe(true)
    expect(samePodShape({ a: { vcpus: 4, memoryGb: 8 }, b: { vcpus: 4, memoryGb: 16 } })).toBe(
      false,
    )
  })
})
