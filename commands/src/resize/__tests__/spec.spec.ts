import { describe, expect, it } from 'bun:test'
import { ECommandRunsIn } from '@dltech/atlas-commands'

import { REFUSAL_RESIZE_USAGE, resize, resizeArgs } from '../spec'

describe('resize spec', () => {
  it('runs in the control plane and has no inbox entry', () => {
    expect(resize.spec.name).toBe('resize')
    expect(resize.spec.runsIn).toBe(ECommandRunsIn.Control)
    expect(resize.spec.argumentHint).toBe('<vcpus> <memoryGb> [diskGb] [--idle]')
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

  it('takes a bigger disk beside the shape', () => {
    expect(resizeArgs.parse({ vcpus: 4, memoryGb: 16, diskGb: 30 })).toEqual({
      vcpus: 4,
      memoryGb: 16,
      diskGb: 30,
    })
    expect(resizeArgs.parse({ vcpus: 4, memoryGb: 16, diskGb: 100 })).toEqual({
      vcpus: 4,
      memoryGb: 16,
      diskGb: 100,
    })
  })

  it('refuses a disk outside the range a pod can hold', () => {
    expect(resizeArgs.safeParse({ vcpus: 4, memoryGb: 16, diskGb: 0 }).success).toBe(false)
    expect(resizeArgs.safeParse({ vcpus: 4, memoryGb: 16, diskGb: 101 }).success).toBe(false)
    expect(resizeArgs.safeParse({ vcpus: 4, memoryGb: 16, diskGb: 30.5 }).success).toBe(false)
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

describe('resize fromText', () => {
  it('reads the shape from the argument text', () => {
    expect(resize.spec.fromText?.('4 16')).toEqual({ ok: true, args: { vcpus: 4, memoryGb: 16 } })
    expect(resize.spec.fromText?.('8 32 40')).toEqual({
      ok: true,
      args: { vcpus: 8, memoryGb: 32, diskGb: 40 },
    })
  })

  it('reads the wait-until-idle flag in any position after the shape', () => {
    expect(resize.spec.fromText?.('4 16 --idle')).toEqual({
      ok: true,
      args: { vcpus: 4, memoryGb: 16, whenIdle: true },
    })
    expect(resize.spec.fromText?.('4 16 40 --idle')).toEqual({
      ok: true,
      args: { vcpus: 4, memoryGb: 16, diskGb: 40, whenIdle: true },
    })
  })

  it.each(['', '4', 'four 16', '4 16 extra', '4 16 40 60', '4 16 --idle --idle', '3 16'])(
    'refuses %p with the usage sentence',
    (argumentText) => {
      expect(resize.spec.fromText?.(argumentText)).toEqual({
        ok: false,
        reason: REFUSAL_RESIZE_USAGE,
      })
    },
  )
})
