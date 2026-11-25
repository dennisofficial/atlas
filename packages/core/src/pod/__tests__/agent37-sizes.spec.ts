import { describe, expect, it } from 'bun:test'

import {
  AGENT37_SIZE_OPTIONS,
  agent37ShapeOfVcpus,
  agent37SizeOptionOf,
  podShapeOfSetting,
} from '../agent37-sizes'
import { AGENT37_POD_SHAPES } from '../pod-shapes'

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

describe('podShapeOfSetting', () => {
  it('boots the shape the stored vcpus and memory name', () => {
    expect(podShapeOfSetting({ vcpus: 4, memoryGb: 16 })).toEqual({ vcpus: 4, memoryGb: 16 })
    expect(podShapeOfSetting({ vcpus: 4, memoryGb: 32 })).toEqual({ vcpus: 4, memoryGb: 32 })
    expect(podShapeOfSetting({ vcpus: 8, memoryGb: 64 })).toEqual({ vcpus: 8, memoryGb: 64 })
  })

  it('boots the shape the vcpus name when the memory is not a shape', () => {
    expect(podShapeOfSetting({ vcpus: 4, memoryGb: 12 })).toEqual({ vcpus: 4, memoryGb: 8 })
    expect(podShapeOfSetting({ vcpus: 4, memoryGb: 64 })).toEqual({ vcpus: 4, memoryGb: 8 })
  })

  it('boots the smallest shape at that vcpus when no memory is stored', () => {
    expect(podShapeOfSetting({ vcpus: 4, memoryGb: undefined })).toEqual({ vcpus: 4, memoryGb: 8 })
    expect(podShapeOfSetting({ vcpus: 6, memoryGb: undefined })).toEqual({ vcpus: 8, memoryGb: 64 })
  })
})

describe('agent37SizeOptionOf', () => {
  it('labels an option with its vcpus, its memory and the shape key it saves', () => {
    expect(agent37SizeOptionOf({ vcpus: 4, memoryGb: 8 })).toEqual({
      value: '4x8',
      label: '4 vCPU',
      detail: '8 GB RAM',
    })
    expect(agent37SizeOptionOf({ vcpus: 4, memoryGb: 16 })).toEqual({
      value: '4x16',
      label: '4 vCPU',
      detail: '16 GB RAM',
    })
  })
})

describe('AGENT37_SIZE_OPTIONS', () => {
  it('offers one option per vm shape agent37 boots', () => {
    expect(AGENT37_SIZE_OPTIONS).toEqual([
      { value: '2x4', label: '2 vCPU', detail: '4 GB RAM' },
      { value: '4x8', label: '4 vCPU', detail: '8 GB RAM' },
      { value: '4x16', label: '4 vCPU', detail: '16 GB RAM' },
      { value: '4x32', label: '4 vCPU', detail: '32 GB RAM' },
      { value: '8x64', label: '8 vCPU', detail: '64 GB RAM' },
    ])
  })
})
