import { describe, expect, it } from 'bun:test'
import { ECommandTiming } from '@dltech/atlas-core'

import { resize, resizeArgs } from '../spec'

describe('resize spec', () => {
  it('is handled in the control plane at once and has no inbox entry', () => {
    expect(resize.spec.name).toBe('resize')
    expect(resize.spec.handledIn).toBe('control')
    expect(resize.spec.timing).toBe(ECommandTiming.Immediate)
  })

  it('takes a shape rather than a bare vCPU count', () => {
    expect(resizeArgs.parse({ vcpus: 1, memoryGb: 2 })).toEqual({ vcpus: 1, memoryGb: 2 })
    expect(resizeArgs.parse({ vcpus: 8, memoryGb: 64 })).toEqual({ vcpus: 8, memoryGb: 64 })
    expect(resizeArgs.parse({ vcpus: 32, memoryGb: 64 })).toEqual({ vcpus: 32, memoryGb: 64 })
  })

  it('takes the wait-until-idle choice as a flag beside the shape', () => {
    expect(resizeArgs.parse({ vcpus: 4, memoryGb: 16, whenIdle: true })).toEqual({
      vcpus: 4,
      memoryGb: 16,
      whenIdle: true,
    })
  })

  it.each([
    { vcpus: 0, memoryGb: 4 },
    { vcpus: 3, memoryGb: 8 },
    { vcpus: 34, memoryGb: 68 },
    { vcpus: 2.5, memoryGb: 5 },
    { vcpus: 4 },
    { vcpus: 4, memoryGb: 0 },
    { vcpus: 4, memoryGb: 7.5 },
    {},
    { vcpus: 4, memoryGb: 8, extra: 1 },
    { vcpus: 4, memoryGb: 8, whenIdle: 'yes' },
  ])('refuses %p', (args) => {
    expect(resizeArgs.safeParse(args).success).toBe(false)
  })
})
