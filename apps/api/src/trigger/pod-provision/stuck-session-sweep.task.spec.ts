import { describe, expect, it, mock } from 'bun:test'
import { EnvService } from '../../_core/config/env/env.service'

mock.module('@trigger.dev/sdk', () => ({
  schemaTask: <T>(definition: T): T => definition,
  schedules: { task: <T>(definition: T): T => definition },
  TriggerClient: class {
    readonly tasks = { trigger: async () => ({ id: 'run_stub' }) }
  },
}))

const { stuckSessionSweepTask } = await import('./stuck-session-sweep.task')
const { buildStuckSessionSweepGraph } = await import('./stuck-session-sweep-graph')

describe('stuckSessionSweepTask', () => {
  it('registers the sweep every five minutes with one attempt', () => {
    expect(stuckSessionSweepTask).toMatchObject({
      id: 'stuck-session-sweep',
      cron: '*/5 * * * *',
      retry: { maxAttempts: 1 },
    })
  })
})

describe('buildStuckSessionSweepGraph', () => {
  it('builds the recovery dependencies by hand from the worker env', async () => {
    const env = new EnvService({
      SECRETS_ENCRYPTION_KEY: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      TRIGGER_SECRET_KEY: 'tr_dev_fixture',
    })

    const { deps, dispose } = buildStuckSessionSweepGraph({ env })

    expect(typeof deps.pod.claim).toBe('function')
    expect(typeof deps.pod.dispatchClaimed).toBe('function')
    await dispose()
  })
})
