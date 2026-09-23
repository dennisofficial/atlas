import { ServiceUnavailableException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { DrainStateService } from './drain-state.service'
import { HealthController } from './health.controller'
import {
  EMigrationState,
  MigrationStateService,
  type MigrationReport,
} from './migration-state.service'

const reporting = (report: MigrationReport): MigrationStateService => {
  const service = new MigrationStateService()
  vi.spyOn(service, 'report').mockResolvedValue(report)
  return service
}

const buildController = (report: MigrationReport): HealthController =>
  new HealthController(reporting(report), new DrainStateService())

describe('HealthController', () => {
  it('reports ok with the service name when the schema is level', async () => {
    const health = await buildController({
      state: EMigrationState.Level,
      pending: [],
    }).handleHealth()

    expect(health.status).toBe('ok')
    expect(health.service).toBe('api')
    expect(health.migrations).toBe(EMigrationState.Level)
  })

  it('refuses to be healthy when the build expects migrations the database has not run', async () => {
    const controller = buildController({
      state: EMigrationState.Behind,
      pending: ['20260915230000_secret_version'],
    })

    await expect(controller.handleHealth()).rejects.toBeInstanceOf(ServiceUnavailableException)
    await expect(controller.handleHealth()).rejects.toThrow('20260915230000_secret_version')
  })

  it('stays healthy when the schema cannot be read, so a database blip is not a failed deploy', async () => {
    const health = await buildController({
      state: EMigrationState.Unknown,
      pending: [],
    }).handleHealth()

    expect(health.status).toBe('ok')
    expect(health.migrations).toBe(EMigrationState.Unknown)
  })

  it('refuses to be healthy while draining, so the edge stops routing before the listener closes', async () => {
    const drain = new DrainStateService()
    const controller = new HealthController(
      reporting({ state: EMigrationState.Level, pending: [] }),
      drain,
    )

    drain.beginDrain()

    await expect(controller.handleHealth()).rejects.toBeInstanceOf(ServiceUnavailableException)
    await expect(controller.handleHealth()).rejects.toThrow('draining')
  })
})
