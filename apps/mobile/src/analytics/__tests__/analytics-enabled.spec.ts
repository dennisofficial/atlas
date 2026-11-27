import { describe, expect, it } from 'bun:test'

import { analyticsEnabledOf } from '../analytics-enabled'

describe('analyticsEnabledOf', () => {
  it('is off without a key', () => {
    expect(analyticsEnabledOf({ apiKey: undefined })).toBe(false)
  })

  it('is off with an empty key', () => {
    expect(analyticsEnabledOf({ apiKey: '' })).toBe(false)
  })

  it('is on with a key', () => {
    expect(analyticsEnabledOf({ apiKey: 'phc_test' })).toBe(true)
  })
})
