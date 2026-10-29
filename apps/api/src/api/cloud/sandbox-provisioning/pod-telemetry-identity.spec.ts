import { describe, expect, it } from 'bun:test'
import { podTelemetryIdentity } from './pod-telemetry-identity'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('podTelemetryIdentity', () => {
  it('renders a UUID-shaped stable id from the user id', () => {
    const id = podTelemetryIdentity({ userId: 'usr-1', pepper: 'p' })

    expect(podTelemetryIdentity({ userId: 'usr-1', pepper: 'p' })).toBe(id)
    expect(podTelemetryIdentity({ userId: 'usr-2', pepper: 'p' })).not.toBe(id)
    expect(podTelemetryIdentity({ userId: 'usr-1', pepper: 'q' })).not.toBe(id)
    expect(id).toMatch(UUID_V4)
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
  })
})
