import { describe, expect, it } from 'bun:test'

import { headingFitsOf } from '../new-session-heading'

describe('headingFitsOf', () => {
  it('shows the heading when it and the composer fit above the keyboard', () => {
    expect(headingFitsOf({ available: 400, heading: 80, composer: 200 })).toBe(true)
  })

  it('hides the heading once the composer needs its room', () => {
    expect(headingFitsOf({ available: 260, heading: 80, composer: 200 })).toBe(false)
  })

  it('shows the heading before the screen is measured', () => {
    expect(headingFitsOf({ available: 0, heading: 80, composer: 200 })).toBe(true)
  })

  it('shows the heading when it fills the room exactly', () => {
    expect(headingFitsOf({ available: 280, heading: 80, composer: 200 })).toBe(true)
  })
})
