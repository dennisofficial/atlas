import { describe, expect, it } from 'bun:test'

import { CHANNEL_PROTOCOL_VERSION } from '../channel-wire'
import { VercelDriver } from '../vercel-driver'
import { CREDENTIALS, PINNED_VERSION, fakeSandbox, fakeDriveSdk } from './vercel-driver-fixture'

describe('createOrResume', () => {
  it('rotates a live running sandbox whose baked serve predates the pinned version: delete, recreate, no drain when nothing is in flight', async () => {
    const stale = fakeSandbox({ installedVersion: '1.19.1', status: 'running', alive: true })
    const fresh = fakeSandbox()
    const events: string[] = []
    Object.assign(stale, {
      delete: async () => {
        events.push('delete')
      },
      runCommand: ((original) => async (params: { cmd: string; args?: string[] }) => {
        if (params.args?.[1]?.includes('/v1/drain')) events.push('drain')
        return original(params)
      })(
        stale.runCommand.bind(stale) as (params: {
          cmd: string
          args?: string[]
        }) => Promise<unknown>,
      ),
    })
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      driveSdk: fakeDriveSdk().sdk,
      image: `atlas-sandbox:${PINNED_VERSION}`,
      serveVersion: PINNED_VERSION,
      runtimeHealth: async () => ({
        busy: false,
        childrenRunning: 0,
        shellsRunning: 0,
        servicesRunning: 0,
        pendingInput: false,
        settlingWork: false,
        clients: 0,
      }),
      sdk: {
        get: async () => stale,
        getOrCreate: async (params) => {
          events.push('recreate')
          await params?.onCreate?.(fresh)
          return fresh
        },
      },
    })

    const placement = await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
      onRotationStarted: () => {
        events.push('rotation-started')
      },
    })

    expect(events).toEqual(['rotation-started', 'delete', 'recreate'])
    expect(placement.created).toBe(true)
    expect(placement.rotatedFrom).toBe('1.19.1')
    expect(placement.rotatedProtocol).toBeUndefined()
  })

  it('recreates a stopped sandbox whose baked serve predates the pin without waking its runtime', async () => {
    const stale = fakeSandbox({ installedVersion: '1.19.1', status: 'stopped' })
    const fresh = fakeSandbox({ installedVersion: PINNED_VERSION })
    let getOrCreateParams: Record<string, unknown> | undefined
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      driveSdk: fakeDriveSdk().sdk,
      image: `atlas-sandbox:${PINNED_VERSION}`,
      serveVersion: PINNED_VERSION,
      runtimeHealth: async () => ({
        busy: false,
        childrenRunning: 0,
        shellsRunning: 0,
        servicesRunning: 0,
        pendingInput: false,
        settlingWork: false,
        clients: 0,
      }),
      sdk: {
        get: async () => stale,
        getOrCreate: async (params) => {
          getOrCreateParams = params as Record<string, unknown>
          return fresh
        },
      },
    })

    await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
    })

    expect(stale.deleted).toBe(true)
    expect(getOrCreateParams?.image).toBe(`atlas-sandbox:${PINNED_VERSION}`)
  })

  it('rotates a running sandbox whose serve speaks another wire protocol: drain, delete, recreate', async () => {
    const stale = fakeSandbox({
      installedProtocol: String(CHANNEL_PROTOCOL_VERSION - 1),
      status: 'running',
    })
    const fresh = fakeSandbox()
    const events: string[] = []
    Object.assign(stale, {
      delete: async () => {
        events.push('delete')
      },
      runCommand: ((original) => async (params: { cmd: string; args?: string[] }) => {
        if (params.args?.[1]?.includes('/v1/drain')) events.push('drain')
        return original(params)
      })(
        stale.runCommand.bind(stale) as (params: {
          cmd: string
          args?: string[]
        }) => Promise<unknown>,
      ),
    })
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      driveSdk: fakeDriveSdk().sdk,
      image: `atlas-sandbox:${PINNED_VERSION}`,
      serveVersion: PINNED_VERSION,
      runtimeHealth: async () => ({ busy: true, clients: 1 }),
      sdk: {
        get: async () => stale,
        getOrCreate: async (params) => {
          events.push('recreate')
          await params?.onCreate?.(fresh)
          return fresh
        },
      },
    })

    const placement = await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
      onRotationStarted: () => {
        events.push('rotation-started')
      },
    })

    expect(events).toEqual(['rotation-started', 'drain', 'delete', 'recreate'])
    expect(placement.created).toBe(true)
    expect(placement.rotatedProtocol).toBe(CHANNEL_PROTOCOL_VERSION - 1)
    expect(placement.rotatedFrom).toBeUndefined()
  })

  it('preserves a busy sandbox and its drive when its serve cannot confirm preparation', async () => {
    const stale = fakeSandbox({ installedProtocol: '', drainStatus: '404', alive: true })
    const fresh = fakeSandbox()
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      driveSdk: fakeDriveSdk().sdk,
      image: `atlas-sandbox:${PINNED_VERSION}`,
      serveVersion: PINNED_VERSION,
      runtimeHealth: async () => ({ busy: true, turnRunning: true, clients: 1 }),
      sdk: { get: async () => stale, getOrCreate: async () => fresh },
    })

    await expect(
      driver.createOrResume({ name: 'atlas-thread-x', threadId: 'brn_cloud', token: 't' }),
    ).rejects.toThrow('HTTP 404')

    expect(stale.deleted).toBe(false)
    expect(fresh.commands).toHaveLength(0)
  })

  it('recreates an idle sandbox whose serve is too old to confirm preparation — there is nothing in flight for the drain to lose', async () => {
    const stale = fakeSandbox({ installedProtocol: '', drainStatus: '404' })
    const fresh = fakeSandbox()
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      driveSdk: fakeDriveSdk().sdk,
      image: `atlas-sandbox:${PINNED_VERSION}`,
      serveVersion: PINNED_VERSION,
      runtimeHealth: async () => ({
        busy: false,
        childrenRunning: 0,
        shellsRunning: 0,
        servicesRunning: 0,
        pendingInput: false,
        settlingWork: false,
        clients: 0,
      }),
      sdk: { get: async () => stale, getOrCreate: async () => fresh },
    })

    await driver.createOrResume({ name: 'atlas-thread-x', threadId: 'brn_cloud', token: 't' })

    expect(stale.deleted).toBe(true)
  })

  it('recreates a stopped sandbox whose version file is missing — the file ships with the image, so its absence means an older bake', async () => {
    const ancient = fakeSandbox({ installedVersion: '', status: 'stopped' })
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      driveSdk: fakeDriveSdk().sdk,
      image: `atlas-sandbox:${PINNED_VERSION}`,
      serveVersion: PINNED_VERSION,
      runtimeHealth: async () => ({
        busy: false,
        childrenRunning: 0,
        shellsRunning: 0,
        servicesRunning: 0,
        pendingInput: false,
        settlingWork: false,
        clients: 0,
      }),
      sdk: { get: async () => ancient, getOrCreate: async () => fakeSandbox() },
    })

    await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
    })

    expect(ancient.deleted).toBe(true)
  })
})
