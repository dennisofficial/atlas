import { describe, expect, it } from 'bun:test'
import type { Sandbox } from '@vercel/sandbox'

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

describe('renewDeadline', () => {
  const renewable = (args: { sessionId?: string; status?: string }): Sandbox => {
    const extensions: number[] = []
    const sandbox: unknown = {
      name: 'x',
      status: 'running',
      expiresAt: new Date(1_000_000),
      extensions,
      currentSession: () => ({
        sessionId: args.sessionId ?? 'session-1',
        status: args.status ?? 'running',
        startedAt: new Date(500_000),
        extendTimeout: async (delta: number) => {
          extensions.push(delta)
        },
      }),
    }
    return sandbox as Sandbox
  }
  const extensionsOf = (sandbox: Sandbox): number[] =>
    (sandbox as unknown as { extensions: number[] }).extensions

  it('extends the live session without resuming the sandbox', async () => {
    const sandbox = renewable({})
    const gets: unknown[] = []
    const { driver } = driverWith({
      sdk: {
        get: async (params) => {
          gets.push(params)
          return sandbox
        },
      },
    })

    const observation = await driver.renewDeadline({
      name: 'x',
      sessionId: 'session-1',
      until: 1_600_000,
    })

    expect(extensionsOf(sandbox)).toEqual([600_000])
    expect(observation).toMatchObject({
      sessionId: 'session-1',
      extendedByMs: 600_000,
    })
    expect(gets.at(-1)).toMatchObject({ resume: false })
  })

  it('refuses a stale session without extending', async () => {
    const sandbox = renewable({ sessionId: 'session-new' })
    const { driver } = driverWith({ sdk: { get: async () => sandbox } })

    await expect(
      driver.renewDeadline({
        name: 'x',
        sessionId: 'session-1',
        until: 1_600_000,
      }),
    ).rejects.toThrow()
    expect(extensionsOf(sandbox)).toEqual([])
  })
})
