import { describe, expect, it } from 'bun:test'
import { ECommandTiming } from '@dltech/atlas-core'

import { resize, resizeArgs } from '../spec'

describe('resize spec', () => {
  it('is handled in the control plane at once and has no inbox entry', () => {
    expect(resize.spec.name).toBe('resize')
    expect(resize.spec.handledIn).toBe('control')
    expect(resize.spec.timing).toBe(ECommandTiming.Immediate)
  })

  it('accepts the pod sizes Vercel offers', () => {
    expect(resizeArgs.parse({ vcpus: 1 })).toEqual({ vcpus: 1 })
    expect(resizeArgs.parse({ vcpus: 8 })).toEqual({ vcpus: 8 })
    expect(resizeArgs.parse({ vcpus: 32 })).toEqual({ vcpus: 32 })
  })

  it('takes the wait-until-idle choice as a flag beside the size', () => {
    expect(resizeArgs.parse({ vcpus: 4, whenIdle: true })).toEqual({ vcpus: 4, whenIdle: true })
    expect(resizeArgs.parse({ vcpus: 4, whenIdle: false })).toEqual({ vcpus: 4, whenIdle: false })
  })

  it.each([
    { vcpus: 0 },
    { vcpus: 3 },
    { vcpus: 34 },
    { vcpus: 2.5 },
    {},
    { vcpus: 4, extra: 1 },
    { vcpus: 4, whenIdle: 'yes' },
  ])('refuses %p', (args) => {
    expect(resizeArgs.safeParse(args).success).toBe(false)
  })
})
