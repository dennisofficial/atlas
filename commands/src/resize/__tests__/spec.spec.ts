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

  it.each([{ vcpus: 0 }, { vcpus: 3 }, { vcpus: 34 }, { vcpus: 2.5 }, {}, { vcpus: 4, extra: 1 }])(
    'refuses %p',
    (args) => {
      expect(resizeArgs.safeParse(args).success).toBe(false)
    },
  )
})
