import { describe, expect, it } from 'bun:test'

import { APIError } from '@vercel/sandbox'

import { ECloudSandboxState } from '../sandbox-client'
import { VercelDriver } from '../vercel-driver'
import { SandboxMissingError } from '@dltech/atlas-wire'
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

describe('updateResources', () => {
  it('resizes the live sandbox through an instance update', async () => {
    const sandbox = fakeSandbox({ vcpus: 2, memoryMb: 4096 })
    const { driver } = driverWith({ sdk: { get: async () => sandbox } })

    await driver.updateResources({ name: 'x', vcpus: 4 })

    expect(sandbox.resourceUpdates).toEqual([4])
  })

  it('reads a missing sandbox as gone', async () => {
    const { driver } = driverWith({
      sdk: {
        get: async () => {
          throw notFound()
        },
      },
    })

    await expect(driver.updateResources({ name: 'x', vcpus: 4 })).rejects.toBeInstanceOf(
      SandboxMissingError,
    )
  })
})

describe('readResources', () => {
  it('answers the allocation the provider reports', async () => {
    const sandbox = fakeSandbox({ vcpus: 4, memoryMb: 8192 })
    const { driver } = driverWith({ sdk: { get: async () => sandbox } })

    expect(await driver.readResources({ name: 'x' })).toEqual({ vcpus: 4, memoryMb: 8192 })
  })

  it('omits fields the provider does not report rather than answering zero', async () => {
    const { driver } = driverWith({ sdk: { get: async () => fakeSandbox() } })

    expect(await driver.readResources({ name: 'x' })).toEqual({})
  })

  it('reads a missing sandbox as gone', async () => {
    const { driver } = driverWith({
      sdk: {
        get: async () => {
          throw notFound()
        },
      },
    })

    await expect(driver.readResources({ name: 'x' })).rejects.toBeInstanceOf(SandboxMissingError)
  })
})
