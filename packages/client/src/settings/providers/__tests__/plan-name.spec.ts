import { describe, expect, it } from 'bun:test'

import { planNameOf } from '../accounts'

describe('planNameOf', () => {
  it('names the plans it knows', () => {
    expect(planNameOf('max')).toBe('Max')
    expect(planNameOf('Pro')).toBe('Pro')
    expect(planNameOf('plus')).toBe('Plus')
    expect(planNameOf('team')).toBe('Team')
    expect(planNameOf('enterprise')).toBe('Enterprise')
  })

  it('calls any business plan Business', () => {
    expect(planNameOf('self_serve_business_prolite')).toBe('Business')
    expect(planNameOf('business')).toBe('Business')
  })

  it('title-cases the raw words of an unknown plan', () => {
    expect(planNameOf('max_20x')).toBe('Max 20x')
    expect(planNameOf('Pro')).toBe('Pro')
  })

  it('has no plan word when the subscription is empty', () => {
    expect(planNameOf('')).toBeNull()
    expect(planNameOf(undefined)).toBeNull()
    expect(planNameOf(null)).toBeNull()
  })
})
