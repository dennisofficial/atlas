import { describe, expect, it } from 'bun:test'

import {
  AGENT37_SIZE_OPTIONS,
  AGENT37_SIZE_VCPUS,
  agent37ShapeOfVcpus,
  agent37SizeOptionOf,
} from '../agent37-sizes'
import { AGENT37_POD_SHAPES } from '../pod-shapes'

describe('AGENT37_SIZE_VCPUS', () => {
  it('offers the three vCPU counts a project can pick', () => {
    expect([...AGENT37_SIZE_VCPUS]).toEqual([2, 4, 8])
  })
})

describe('agent37ShapeOfVcpus', () => {
  it('boots the smallest vm shape that covers the vcpus asked for', () => {
    expect(agent37ShapeOfVcpus(2)).toEqual({ vcpus: 2, memoryGb: 4 })
    expect(agent37ShapeOfVcpus(4)).toEqual({ vcpus: 4, memoryGb: 8 })
    expect(agent37ShapeOfVcpus(8)).toEqual({ vcpus: 8, memoryGb: 64 })
  })

  it('rounds a size with no vm shape up to the next one', () => {
    expect(agent37ShapeOfVcpus(1)).toEqual({ vcpus: 2, memoryGb: 4 })
    expect(agent37ShapeOfVcpus(3)).toEqual({ vcpus: 4, memoryGb: 8 })
    expect(agent37ShapeOfVcpus(6)).toEqual({ vcpus: 8, memoryGb: 64 })
  })

  it('falls back to the largest shape above every vm shape agent37 has', () => {
    expect(agent37ShapeOfVcpus(32)).toEqual({ vcpus: 8, memoryGb: 64 })
  })

  it('always names a shape agent37 actually boots', () => {
    for (const vcpus of [1, 2, 3, 4, 6, 8, 12, 32]) {
      expect(AGENT37_POD_SHAPES).toContainEqual(agent37ShapeOfVcpus(vcpus))
    }
  })
})

describe('agent37SizeOptionOf', () => {
  it('labels an option with its vcpus and the memory that shape boots', () => {
    expect(agent37SizeOptionOf({ vcpus: 4, memoryGb: 8 })).toEqual({
      value: '4',
      label: '4 vCPU',
      detail: '8 GB RAM',
    })
    expect(agent37SizeOptionOf({ vcpus: 4, memoryGb: 16 })).toEqual({
      value: '4',
      label: '4 vCPU',
      detail: '16 GB RAM',
    })
  })
})

describe('AGENT37_SIZE_OPTIONS', () => {
  it('labels each offered size with the memory it really boots', () => {
    expect(AGENT37_SIZE_OPTIONS).toEqual([
      { value: '2', label: '2 vCPU', detail: '4 GB RAM' },
      { value: '4', label: '4 vCPU', detail: '8 GB RAM' },
      { value: '8', label: '8 vCPU', detail: '64 GB RAM' },
    ])
  })
})
