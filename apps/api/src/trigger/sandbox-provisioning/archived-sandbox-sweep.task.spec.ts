import { describe, expect, it, mock } from 'bun:test'
import { EnvService } from '../../_core/config/env/env.service'

mock.module('@trigger.dev/sdk', () => ({
  schemaTask: <T>(definition: T): T => definition,
  schedules: { task: <T>(definition: T): T => definition },
  TriggerClient: class {
    readonly tasks = { trigger: async () => ({ id: 'run_stub' }) }
  },
}))

const { archivedSandboxSweepTask } = await import('./archived-sandbox-sweep.task')
const { buildArchivedSandboxSweepGraph } = await import('./archived-sandbox-sweep-graph')

describe('archivedSandboxSweepTask', () => {
  it('registers the sweep daily with one attempt', () => {
    expect(archivedSandboxSweepTask).toMatchObject({
      id: 'archived-sandbox-sweep',
      cron: '23 6 * * *',
      retry: { maxAttempts: 1 },
    })
  })
})

describe('buildArchivedSandboxSweepGraph', () => {
  it('builds the sweep dependencies by hand from the worker env', async () => {
    const env = new EnvService({
      SECRETS_ENCRYPTION_KEY: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      TRIGGER_SECRET_KEY: 'tr_dev_fixture',
    })

    const { deps, dispose } = buildArchivedSandboxSweepGraph({ env })

    expect(typeof deps.deleteSandbox).toBe('function')
    expect(typeof deps.podChanged).toBe('function')
    await dispose()
  })
})
