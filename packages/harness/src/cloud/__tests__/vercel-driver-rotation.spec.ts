import { describe, expect, it } from 'bun:test'

import { CHANNEL_PROTOCOL_VERSION } from '../channel-wire'
import { VercelDriver } from '../vercel-driver'
import type { FakeSandbox } from './vercel-driver-sandbox-fixture'
import { CREDENTIALS, PINNED_VERSION, fakeSandbox, fakeDriveSdk } from './vercel-driver-fixture'

const IDLE_HEALTH = async () => ({
  busy: false,
  childrenRunning: 0,
  shellsRunning: 0,
  servicesRunning: 0,
  pendingInput: false,
  settlingWork: false,
  clients: 0,
})

type RunParams = { cmd: string; args?: string[] }

const trackSwap = ({
  sandbox,
  events,
  serveRetired,
}: {
  sandbox: FakeSandbox
  events: string[]
  serveRetired: boolean
}) => {
  let retired = serveRetired
  let downloaded = false
  const run = sandbox.runCommand.bind(sandbox) as (params: RunParams) => Promise<unknown>
  const remove = sandbox.delete.bind(sandbox)
  Object.assign(sandbox, {
    delete: async (...params: Parameters<FakeSandbox['delete']>) => {
      events.push('delete')
      return remove(...params)
    },
    runCommand: async (params: RunParams) => {
      const script = params.args?.[1] ?? ''
      if (script.includes('/v1/drain')) {
        events.push('drain')
        retired = true
      }
      if (script.includes('atlas-serve.pid') && script.includes('kill')) retired = true
      if (script.includes('atlas-serve-linux-x64')) {
        events.push('download')
        downloaded = true
        retired = false
      }
      const healthProbe = script.includes('/v1/health') && script.includes('-o /dev/null')
      if (retired && !downloaded && healthProbe) return { exitCode: 1 }
      if (retired && script.startsWith('kill -0')) return { exitCode: 1 }
      return run(params)
    },
  })
}

const swapDriver = ({
  sandbox,
  runtimeHealth,
}: {
  sandbox: FakeSandbox
  runtimeHealth: () => Promise<Record<string, unknown>>
}) =>
  new VercelDriver({
    credentials: CREDENTIALS,
    cloudUrl: 'https://api.example.com',
    driveSdk: fakeDriveSdk().sdk,
    image: `atlas-sandbox:${PINNED_VERSION}`,
    serveVersion: PINNED_VERSION,
    runtimeHealth,
    sdk: { get: async () => sandbox, getOrCreate: async () => sandbox },
  })

const request = { name: 'atlas-thread-x', threadId: 'brn_cloud', token: 't' }

describe('createOrResume', () => {
  it('swaps serve in place on a live running sandbox whose baked serve predates the pin — no delete, no recreate, no drain when idle', async () => {
    const stale = fakeSandbox({ installedVersion: '1.19.1', status: 'running', alive: true })
    const events: string[] = []
    trackSwap({ sandbox: stale, events, serveRetired: true })

    const placement = await swapDriver({
      sandbox: stale,
      runtimeHealth: IDLE_HEALTH,
    }).createOrResume({
      ...request,
      onRotationStarted: () => {
        events.push('rotation-started')
      },
    })

    expect(events).not.toContain('delete')
    expect(events).not.toContain('drain')
    expect(events).toContain('download')
    expect(stale.deleted).toBe(false)
    expect(placement.created).toBe(false)
    expect(placement.rotatedFrom).toBe('1.19.1')
    expect(placement.rotatedProtocol).toBeUndefined()
  })

  it('swaps a stopped sandbox whose baked serve predates the pin in place — resumed, not deleted, no drain', async () => {
    const stale = fakeSandbox({ installedVersion: '1.19.1', status: 'stopped' })
    const events: string[] = []
    trackSwap({ sandbox: stale, events, serveRetired: true })

    const placement = await swapDriver({ sandbox: stale, runtimeHealth: IDLE_HEALTH }).createOrResume(request)

    expect(events).toEqual(['download'])
    expect(stale.deleted).toBe(false)
    expect(placement.created).toBe(false)
  })

  it('swaps a running sandbox whose serve speaks another wire protocol in place: drain, then download, never delete', async () => {
    const stale = fakeSandbox({
      installedProtocol: String(CHANNEL_PROTOCOL_VERSION - 1),
      status: 'running',
    })
    const events: string[] = []
    trackSwap({ sandbox: stale, events, serveRetired: false })

    const placement = await swapDriver({
      sandbox: stale,
      runtimeHealth: async () => ({ busy: true, clients: 1 }),
    }).createOrResume({
      ...request,
      onRotationStarted: () => {
        events.push('rotation-started')
      },
    })

    expect(events).toEqual(['rotation-started', 'drain', 'download'])
    expect(stale.deleted).toBe(false)
    expect(placement.created).toBe(false)
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

  it('swaps an idle sandbox whose serve is too old to confirm preparation in place — nothing in flight, so no drain and no delete', async () => {
    const stale = fakeSandbox({
      installedVersion: '1.19.1',
      installedProtocol: '',
      drainStatus: '404',
    })
    const events: string[] = []
    trackSwap({ sandbox: stale, events, serveRetired: true })

    const placement = await swapDriver({ sandbox: stale, runtimeHealth: IDLE_HEALTH }).createOrResume(request)

    expect(events).toEqual(['download'])
    expect(stale.deleted).toBe(false)
    expect(placement.created).toBe(false)
  })

  it('swaps a stopped sandbox whose version file is missing in place — the file ships with the image, so its absence means an older bake', async () => {
    const ancient = fakeSandbox({ installedVersion: '', status: 'stopped' })
    const events: string[] = []
    trackSwap({ sandbox: ancient, events, serveRetired: true })

    const placement = await swapDriver({ sandbox: ancient, runtimeHealth: IDLE_HEALTH }).createOrResume(request)

    expect(events).toEqual(['download'])
    expect(ancient.deleted).toBe(false)
    expect(placement.created).toBe(false)
  })
})
