import { describe, expect, it } from 'bun:test'

import { EPodDiskPressure } from '@dltech/atlas-core'

import { daemonEventSchema, podDiskPressureEventSchema } from '../index'

const event = {
  type: 'pod.disk-pressure',
  usedBytes: 17 * 2 ** 30,
  limitBytes: 20 * 2 ** 30,
  pressure: EPodDiskPressure.Grow,
} as const

describe('pod.disk-pressure', () => {
  it('round-trips through the daemon event union', () => {
    expect(daemonEventSchema.parse(JSON.parse(JSON.stringify(event)))).toEqual(event)
  })

  it('accepts every pressure level the core names', () => {
    for (const pressure of Object.values(EPodDiskPressure)) {
      expect(podDiskPressureEventSchema.safeParse({ ...event, pressure }).success).toBe(true)
    }
  })

  it('rejects a level core does not name, a negative size and an extra key', () => {
    expect(podDiskPressureEventSchema.safeParse({ ...event, pressure: 'full' }).success).toBe(false)
    expect(podDiskPressureEventSchema.safeParse({ ...event, usedBytes: -1 }).success).toBe(false)
    expect(podDiskPressureEventSchema.safeParse({ ...event, freeBytes: 1 }).success).toBe(false)
  })
})
