import { describe, expect, it } from 'bun:test'

import { servicesChipText, servicesItem } from '../services-surface'

describe('servicesChipText', () => {
  it('counts running over declared when anything is declared, even with none running', () => {
    expect(servicesChipText({ running: 0, declaredRunning: 0, declaredTotal: 3 })).toBe(
      '0/3 services',
    )
    expect(servicesChipText({ running: 2, declaredRunning: 2, declaredTotal: 3 })).toBe(
      '2/3 services',
    )
  })

  it('falls back to the running count and hides at none', () => {
    expect(servicesChipText({ running: 1, declaredRunning: 0, declaredTotal: 0 })).toBe('1 service')
    expect(servicesChipText({ running: 0, declaredRunning: 0, declaredTotal: 0 })).toBeNull()
  })
})

describe('servicesItem', () => {
  it('stays visible for declared services and tints attention', () => {
    const calm = servicesItem({
      running: 0,
      declaredRunning: 0,
      declaredTotal: 1,
      onOpen: () => undefined,
    })
    const loud = servicesItem({
      running: 0,
      declaredRunning: 0,
      declaredTotal: 1,
      attention: true,
      onOpen: () => undefined,
    })

    expect(calm?.spans[0]?.text).toBe('0/1 services')
    expect(loud?.ground).not.toBe(calm?.ground)
  })
})
