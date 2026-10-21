import { describe, expect, it, vi } from 'vitest'

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn(async () => [{ '?column?': 1 }]) }))

vi.mock('@trigger.dev/sdk', () => ({
  schemaTask: <T>(definition: T): T => definition,
}))
vi.mock('../../db', () => ({ db: { $queryRaw: queryRaw } }))

import { smokeTaskContract } from './smoke.contract'
import { runSmoke, runSmokeTask, smokeTask } from './smoke.task'

describe('atlas-smoke task', () => {
  it('registers under the contract id with a single attempt', () => {
    expect(smokeTask).toMatchObject({ id: 'atlas-smoke', retry: { maxAttempts: 1 } })
    expect(smokeTaskContract.id).toBe(smokeTask.id)
  })

  it('runs SELECT 1 through the lazy db and reports ok', async () => {
    queryRaw.mockClear()
    const output = await runSmokeTask()
    expect(queryRaw).toHaveBeenCalledTimes(1)
    expect(output.ok).toBe(true)
    expect(Number.isNaN(Date.parse(output.at))).toBe(false)
  })

  it('stamps the time it ran', async () => {
    const database = { $queryRaw: vi.fn(async () => []) }
    const output = await runSmoke({ database, now: () => new Date('2026-10-21T00:00:00Z') })
    expect(output).toEqual({ ok: true, at: '2026-10-21T00:00:00.000Z' })
  })

  it('fails the run when the database query fails', async () => {
    const database = {
      $queryRaw: vi.fn(async () => {
        throw new Error('connection refused')
      }),
    }
    await expect(runSmoke({ database })).rejects.toThrow('connection refused')
  })

  it('accepts only the empty payload', () => {
    expect(smokeTaskContract.schema.safeParse({}).success).toBe(true)
  })
})
