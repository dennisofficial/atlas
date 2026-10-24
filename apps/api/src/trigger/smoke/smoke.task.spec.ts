import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it, mock, vi } from 'bun:test'

mock.module('@trigger.dev/sdk', () => ({
  schemaTask: <T>(definition: T): T => definition,
  schedules: { task: <T>(definition: T): T => definition },
  TriggerClient: class {
    readonly tasks = { trigger: async () => ({ id: 'run_stub' }) }
  },
}))

const { smokeTaskContract } = await import('./smoke.contract')
const { runSmoke, runSmokeTask, smokeTask } = await import('./smoke.task')

describe('atlas-smoke task', () => {
  useTestDatabase()

  it('registers under the contract id with a single attempt', () => {
    expect(smokeTask).toMatchObject({ id: 'atlas-smoke', retry: { maxAttempts: 1 } })
    expect(smokeTaskContract.id).toBe(smokeTask.id)
  })

  it('runs SELECT 1 through the lazy db and reports ok', async () => {
    const output = await runSmokeTask()
    expect(output.ok).toBe(true)
    expect(Number.isNaN(Date.parse(output.at))).toBe(false)
  })

  it('stamps the time it ran', async () => {
    const database = { ping: vi.fn(async () => undefined) }
    const output = await runSmoke({ database, now: () => new Date('2026-10-21T00:00:00Z') })
    expect(output).toEqual({ ok: true, at: '2026-10-21T00:00:00.000Z' })
  })

  it('fails the run when the database query fails', async () => {
    const database = {
      ping: vi.fn(async () => {
        throw new Error('connection refused')
      }),
    }
    await expect(runSmoke({ database })).rejects.toThrow('connection refused')
  })

  it('accepts only the empty payload', () => {
    expect(smokeTaskContract.schema.safeParse({}).success).toBe(true)
  })
})
