import { describe, expect, it } from 'bun:test'

import { ATLAS_TELEMETRY_ENV, ATLAS_TESTING_ENV, telemetryEnabled } from '../../index'

describe('telemetryEnabled', () => {
  it('is on for a plain production environment', () => {
    expect(telemetryEnabled({})).toBe(true)
  })

  it('is off under the repo test-runner signal', () => {
    expect(telemetryEnabled({ [ATLAS_TESTING_ENV]: '1' })).toBe(false)
    expect(telemetryEnabled({ NODE_ENV: 'test' })).toBe(false)
  })

  it('honours an explicit opt-out in production', () => {
    expect(telemetryEnabled({ [ATLAS_TELEMETRY_ENV]: '0' })).toBe(false)
  })

  it('honours an explicit opt-in under the test runner', () => {
    expect(telemetryEnabled({ [ATLAS_TESTING_ENV]: '1', [ATLAS_TELEMETRY_ENV]: '1' })).toBe(true)
    expect(telemetryEnabled({ NODE_ENV: 'test', [ATLAS_TELEMETRY_ENV]: '1' })).toBe(true)
  })
})
