import { describe, expect, it } from 'bun:test'

import { APIError } from '@vercel/sandbox'

import { ECloudSandboxState } from '../sandbox-client'
import { VercelDriver } from '../vercel-driver'
import { SandboxMissingError } from '../vercel-errors'
import { CREDENTIALS, fakeSandbox, driverWith, notFound } from './vercel-driver-fixture'

describe('inspect', () => {
  it('maps the sdk statuses onto the wire states, carrying the sandbox session identity', async () => {
    const { driver } = driverWith({ sdk: { get: async () => fakeSandbox({ status: 'running' }) } })
    expect(await driver.inspect({ name: 'x' })).toEqual({
      state: ECloudSandboxState.Running,
      url: 'https://sb-3000.vercel.run',
      sandboxSessionId: 'session-1',
    })

    const pending = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      sdk: {
        get: async () => fakeSandbox({ status: 'pending' }),
        getOrCreate: async () => fakeSandbox(),
      },
    })
    expect(await pending.inspect({ name: 'x' })).toEqual({
      state: ECloudSandboxState.Resuming,
      url: 'https://sb-3000.vercel.run',
      sandboxSessionId: 'session-1',
    })

    const stopped = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      sdk: {
        get: async () => fakeSandbox({ status: 'stopped' }),
        getOrCreate: async () => fakeSandbox(),
      },
    })
    expect(await stopped.inspect({ name: 'x' })).toEqual({
      state: ECloudSandboxState.Parked,
      url: 'https://sb-3000.vercel.run',
      sandboxSessionId: 'session-1',
    })
  })

  it('reads stopping and snapshotting as unknown, failed and aborted as stopped, never as parked', async () => {
    for (const status of ['stopping', 'snapshotting']) {
      const driver = new VercelDriver({
        credentials: CREDENTIALS,
        cloudUrl: 'https://api.example.com',
        sdk: { get: async () => fakeSandbox({ status }), getOrCreate: async () => fakeSandbox() },
      })
      const observed = await driver.inspect({ name: 'x' })
      expect(observed?.state).toBe(ECloudSandboxState.Unknown)
    }
    for (const status of ['failed', 'aborted']) {
      const driver = new VercelDriver({
        credentials: CREDENTIALS,
        cloudUrl: 'https://api.example.com',
        sdk: { get: async () => fakeSandbox({ status }), getOrCreate: async () => fakeSandbox() },
      })
      const observed = await driver.inspect({ name: 'x' })
      expect(observed?.state).toBe(ECloudSandboxState.Stopped)
    }
  })

  it('answers nothing when Vercel has never heard of the sandbox', async () => {
    const { driver } = driverWith({
      sdk: {
        get: async () => {
          throw notFound()
        },
      },
    })

    expect(await driver.inspect({ name: 'x' })).toBeUndefined()
  })

  it('rethrows a failure that is not a missing sandbox', async () => {
    const { driver } = driverWith({
      sdk: {
        get: async () => {
          throw new APIError(new Response(null, { status: 401 }), { message: 'bad token' })
        },
      },
    })

    await expect(driver.inspect({ name: 'x' })).rejects.toThrow()
  })
})

describe('exposePort', () => {
  it('grows the routed list rather than replacing it, and answers the domain', async () => {
    const sandbox = fakeSandbox({ routes: [3000, 3001] })
    const { driver } = driverWith({ sdk: { get: async () => sandbox } })

    const url = await driver.exposePort({ name: 'x', port: 3002 })

    expect(sandbox.updates).toEqual([[3000, 3001, 3002]])
    expect(url).toBe('https://sb-3002.vercel.run')
  })

  it('does not touch the routes when the port is already exposed', async () => {
    const sandbox = fakeSandbox({ routes: [3000, 3001] })
    const { driver } = driverWith({ sdk: { get: async () => sandbox } })

    await driver.exposePort({ name: 'x', port: 3001 })

    expect(sandbox.updates).toEqual([])
  })

  it('refuses at the port ceiling before asking Vercel for anything', async () => {
    const sandbox = fakeSandbox({ routes: Array.from({ length: 15 }, (_, i) => 3000 + i) })
    const { driver } = driverWith({ sdk: { get: async () => sandbox } })

    await expect(driver.exposePort({ name: 'x', port: 4000 })).rejects.toThrow('at most 15 ports')
    expect(sandbox.updates).toEqual([])
  })

  it('reads a missing sandbox as gone', async () => {
    const { driver } = driverWith({
      sdk: {
        get: async () => {
          throw notFound()
        },
      },
    })

    await expect(driver.exposePort({ name: 'x', port: 3002 })).rejects.toBeInstanceOf(
      SandboxMissingError,
    )
  })
})
