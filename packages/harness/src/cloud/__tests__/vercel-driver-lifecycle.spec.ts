import { describe, expect, it } from 'vitest'

import { fakeSandbox, driverWith, notFound } from './vercel-driver-fixture'

describe('stop and destroy', () => {
  it('stops the sandbox and tolerates one already gone', async () => {
    const sandbox = fakeSandbox()
    const { driver } = driverWith({ sdk: { get: async () => sandbox } })
    await driver.stop({ name: 'x' })
    expect(sandbox.stopped).toBe(true)

    const missing = driverWith({
      sdk: {
        get: async () => {
          throw notFound()
        },
      },
    })
    await expect(missing.driver.stop({ name: 'x' })).resolves.toBeUndefined()
  })

  it('stops the sandbox when the caller holds its live session identity', async () => {
    const sandbox = fakeSandbox()
    const { driver } = driverWith({ sdk: { get: async () => sandbox } })

    await driver.stop({ name: 'x', sessionId: 'session-1' })

    expect(sandbox.stopped).toBe(true)
  })

  it('refuses to stop a sandbox whose live session is not the one the stop was issued for', async () => {
    const sandbox = fakeSandbox()
    const { driver } = driverWith({ sdk: { get: async () => sandbox } })

    await expect(driver.stop({ name: 'x', sessionId: 'session-old' })).rejects.toThrow(
      'refusing to stop sandbox x',
    )

    expect(sandbox.stopped).toBe(false)
  })

  it('deletes the sandbox and tolerates one already gone', async () => {
    const sandbox = fakeSandbox()
    const { driver } = driverWith({ sdk: { get: async () => sandbox } })
    await driver.destroy({ name: 'x' })
    expect(sandbox.deleted).toBe(true)

    const missing = driverWith({
      sdk: {
        get: async () => {
          throw notFound()
        },
      },
    })
    await expect(missing.driver.destroy({ name: 'x' })).resolves.toBeUndefined()
  })

  it('refuses a fenced destroy whose sandbox is already gone', async () => {
    const { driver } = driverWith({
      sdk: {
        get: async () => {
          throw notFound()
        },
      },
    })

    await expect(driver.destroy({ name: 'x', sessionId: 'session-1' })).rejects.toThrow(
      'sandbox x no longer exists on Vercel',
    )
  })
})
