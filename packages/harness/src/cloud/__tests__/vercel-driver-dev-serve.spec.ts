import { describe, expect, it } from 'vitest'

import type { DevServeBinary, ServeInstaller, VercelSdk } from '@dltech/atlas-wire'
import { VercelDriver } from '../vercel-driver'
import { CREDENTIALS, PINNED_VERSION, fakeSandbox, notFound } from './vercel-driver-fixture'

const DEV_PIN = 'dev-bbbbbbbbbbbb'

const IDLE_HEALTH = async () => ({
  busy: false,
  childrenRunning: 0,
  shellsRunning: 0,
  servicesRunning: 0,
  pendingInput: false,
  settlingWork: false,
  clients: 0,
})

const request = { name: 'atlas-thread-x', threadId: 'brn_cloud', token: 't' }

const devBinary = (version: string): DevServeBinary => ({
  version,
  path: `/tmp/dev-serve/${version}/atlas-serve-linux-x64`,
  sha256: 'f'.repeat(64),
  bytes: 154_154_464,
})

const rig = (args: { sdk: VercelSdk; devPin?: string; serveVersion?: string }) => {
  const resolved: number[] = []
  const uploaded: DevServeBinary[] = []
  const installs: (string | undefined)[] = []
  const lines: string[] = []
  const installer: ServeInstaller = async ({ version }) => {
    installs.push(version)
  }
  const devPin = args.devPin
  const driver = new VercelDriver({
    credentials: CREDENTIALS,
    cloudUrl: 'https://api.example.com',
    image: 'atlas-sandbox:latest',
    ...(args.serveVersion === undefined ? {} : { serveVersion: args.serveVersion }),
    ...(devPin === undefined
      ? {}
      : {
          devServe: async () => {
            resolved.push(resolved.length + 1)
            return devBinary(devPin)
          },
        }),
    uploadServe: (binary) => {
      uploaded.push(binary)
      return installer
    },
    runtimeHealth: IDLE_HEALTH,
    settleRetry: { attempts: 10, delayMs: 0 },
    log: (line) => lines.push(line),
    sdk: args.sdk,
  })
  return { driver, resolved, uploaded, installs, lines }
}

describe('createOrResume with a dev serve resolver', () => {
  it('resolves once, uploads the dev binary on a fresh boot and pins the placement to its version', async () => {
    const sandbox = fakeSandbox({ healthy: false })
    const setup = rig({
      devPin: DEV_PIN,
      sdk: {
        get: async () => {
          throw notFound()
        },
        getOrCreate: async () => sandbox,
      },
    })

    const placement = await setup.driver.createOrResume(request)

    expect(setup.resolved).toEqual([1])
    expect(setup.uploaded.map((binary) => binary.version)).toEqual([DEV_PIN])
    expect(setup.installs).toEqual([DEV_PIN])
    expect(placement.serveVersion).toBe(DEV_PIN)
    expect(setup.lines.some((line) => line.includes(`dev serve ${DEV_PIN}`))).toBe(true)
  })

  it('rotates a sandbox carrying another dev serve onto the resolved pin, resolving once for both launches', async () => {
    const sandbox = fakeSandbox({ installedVersion: 'dev-aaaaaaaaaaaa', healthy: false })
    const setup = rig({
      devPin: DEV_PIN,
      serveVersion: PINNED_VERSION,
      sdk: { get: async () => sandbox, getOrCreate: async () => sandbox },
    })

    const placement = await setup.driver.createOrResume(request)

    expect(setup.resolved).toEqual([1])
    expect(placement.rotatedFrom).toBe('dev-aaaaaaaaaaaa')
    expect(setup.installs.length).toBeGreaterThan(1)
    expect(new Set(setup.installs)).toEqual(new Set([DEV_PIN]))
    expect(placement.serveVersion).toBe(DEV_PIN)
  })

  it('keeps a sandbox already carrying the dev pin without uploading anything', async () => {
    const sandbox = fakeSandbox({ installedVersion: DEV_PIN })
    const setup = rig({
      devPin: DEV_PIN,
      sdk: { get: async () => sandbox, getOrCreate: async () => sandbox },
    })

    const placement = await setup.driver.createOrResume(request)

    expect(placement.rotatedFrom).toBeUndefined()
    expect(setup.installs).toEqual([])
    expect(placement.serveVersion).toBe(DEV_PIN)
  })

  it('resolves again on every createOrResume, leaving memoization to the resolver', async () => {
    const sandbox = fakeSandbox({ installedVersion: DEV_PIN })
    const setup = rig({
      devPin: DEV_PIN,
      sdk: { get: async () => sandbox, getOrCreate: async () => sandbox },
    })

    await setup.driver.createOrResume(request)
    await setup.driver.createOrResume(request)

    expect(setup.resolved).toEqual([1, 2])
  })

  it('fails the wake without touching Vercel when the dev serve cannot be built', async () => {
    let touched = 0
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      image: 'atlas-sandbox:latest',
      devServe: async () => {
        throw new Error('bun build failed')
      },
      sdk: {
        get: async () => {
          touched += 1
          return fakeSandbox()
        },
        getOrCreate: async () => {
          touched += 1
          return fakeSandbox()
        },
      },
    })

    await expect(driver.createOrResume(request)).rejects.toThrow('bun build failed')
    expect(touched).toBe(0)
  })
})

describe('createOrResume without a dev serve resolver', () => {
  it('keeps the release pin and never builds an upload installer', async () => {
    const sandbox = fakeSandbox({ installedVersion: PINNED_VERSION })
    const setup = rig({
      serveVersion: PINNED_VERSION,
      sdk: { get: async () => sandbox, getOrCreate: async () => sandbox },
    })

    const placement = await setup.driver.createOrResume(request)

    expect(setup.uploaded).toEqual([])
    expect(setup.installs).toEqual([])
    expect(placement.serveVersion).toBe(PINNED_VERSION)
    expect(setup.lines.some((line) => line.includes('dev serve'))).toBe(false)
  })

  it('carries no serve version on the placement when the build pins none', async () => {
    const sandbox = fakeSandbox()
    const setup = rig({ sdk: { get: async () => sandbox, getOrCreate: async () => sandbox } })

    const placement = await setup.driver.createOrResume(request)

    expect(placement.serveVersion).toBeUndefined()
    expect(setup.uploaded).toEqual([])
  })
})
