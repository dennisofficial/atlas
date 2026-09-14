import { describe, expect, it } from 'vitest'
import { HealthController } from './health.controller'

describe('HealthController', () => {
  it('reports ok with the service name', () => {
    const health = new HealthController().handleHealth()
    expect(health.status).toBe('ok')
    expect(health.service).toBe('api')
  })
})
