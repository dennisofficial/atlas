import { describe, expect, it, vi } from 'vitest'
import { migrateDeployWithRetry } from '../scripts/migrate-deploy.mjs'

const immediateSleep = () => Promise.resolve()
const silentLog = () => {}

describe('migrateDeployWithRetry', () => {
  it('returns 0 on first success without sleeping', async () => {
    const run = vi.fn().mockResolvedValue(0)
    const sleep = vi.fn(immediateSleep)

    const code = await migrateDeployWithRetry({ run, sleep, log: silentLog })

    expect(code).toBe(0)
    expect(run).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('retries after a failure and returns 0 when a later attempt succeeds', async () => {
    const run = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0)
    const sleep = vi.fn(immediateSleep)

    const code = await migrateDeployWithRetry({ run, sleep, log: silentLog })

    expect(code).toBe(0)
    expect(run).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('returns 1 when every attempt fails, sleeping only between attempts', async () => {
    const run = vi.fn().mockResolvedValue(1)
    const sleep = vi.fn(immediateSleep)

    const code = await migrateDeployWithRetry({ run, sleep, log: silentLog, attempts: 3, backoffMs: 5 })

    expect(code).toBe(1)
    expect(run).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })
})
