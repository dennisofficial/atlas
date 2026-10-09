import { describe, expect, it } from 'bun:test'

import { SERVE_TOKEN_PATH } from '../serve-launch'
import { VercelDriver } from '../vercel-driver'
import { EVercelFailure, VercelFailure } from '../vercel-errors'
import {
  CREDENTIALS,
  PINNED_VERSION,
  fakeSandbox,
  fakeDriveSdk,
  driverWith,
  notFound,
  notFoundForProject,
} from './vercel-driver-fixture'

describe('createOrResume', () => {
  it('rides out Vercel reporting the sandbox gone mid-wake, then mounts once the name settles', async () => {
    let calls = 0
    const lines: string[] = []
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      driveSdk: fakeDriveSdk().sdk,
      image: `atlas-sandbox:${PINNED_VERSION}`,
      serveVersion: PINNED_VERSION,
      attachLagRetry: { attempts: 10, delayMs: 0 },
      log: (line) => lines.push(line),
      sdk: {
        get: async () => {
          throw notFound()
        },
        getOrCreate: async () => {
          calls += 1
          if (calls === 1) throw notFoundForProject()
          return fakeSandbox()
        },
      },
    })

    const placement = await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
    })

    expect(calls).toBe(2)
    expect(placement.url).toBe('https://sb-3000.vercel.run')
    expect(lines.some((line) => line.includes('mid-wake'))).toBe(true)
  })

  it('exhausts the mid-wake settle retries into a typed failure naming the cause', async () => {
    let calls = 0
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      driveSdk: fakeDriveSdk().sdk,
      image: `atlas-sandbox:${PINNED_VERSION}`,
      serveVersion: PINNED_VERSION,
      attachLagRetry: { attempts: 10, delayMs: 0 },
      sdk: {
        get: async () => {
          throw notFound()
        },
        getOrCreate: async () => {
          calls += 1
          throw notFoundForProject()
        },
      },
    })

    const failure = await driver
      .createOrResume({ name: 'atlas-thread-x', threadId: 'brn_cloud', token: 't' })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      )

    expect(calls).toBe(10)
    expect(failure).toBeInstanceOf(VercelFailure)
    expect((failure as VercelFailure).kind).toBe(EVercelFailure.Unknown)
    expect((failure as VercelFailure).message).toContain('not found for this project')
  })

  it('trusts the baked serve when the build pins no serve version, whatever the sandbox carries', async () => {
    const unpinned = fakeSandbox({ installedVersion: '0.0.0-ancient' })
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      driveSdk: fakeDriveSdk().sdk,
      image: 'atlas-sandbox:custom',
      sdk: { get: async () => unpinned, getOrCreate: async () => unpinned },
    })

    await driver.createOrResume({ name: 'atlas-thread-x', threadId: 'brn_cloud' })

    expect(unpinned.deleted).toBe(false)
    expect(unpinned.commands.some((script) => script.includes('.protocol'))).toBe(true)
    expect(unpinned.commands.some((script) => script.includes('/v1/drain'))).toBe(false)
  })

  it('resumes an existing sandbox without the created flag, staging the serve token', async () => {
    const sandbox = fakeSandbox()
    let resumeCalls = 0
    const { driver } = driverWith({
      sdk: {
        getOrCreate: async (params) => {
          await params?.onResume?.(sandbox)
          resumeCalls += 1
          return sandbox
        },
      },
    })

    const placement = await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 'serve-token-1',
    })

    expect(placement.created).toBe(false)
    expect(resumeCalls).toBe(1)
    expect(sandbox.written.length).toBeGreaterThan(0)
    expect(
      sandbox.written.every(
        (write) => write.path === SERVE_TOKEN_PATH && write.content === 'serve-token-1',
      ),
    ).toBe(true)
  })

  it('resumes a live sandbox whose baked serve is the pinned version, without destroying it', async () => {
    const current = fakeSandbox({ installedVersion: PINNED_VERSION })
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      driveSdk: fakeDriveSdk().sdk,
      image: `atlas-sandbox:${PINNED_VERSION}`,
      serveVersion: PINNED_VERSION,
      sdk: { get: async () => current, getOrCreate: async () => current },
    })

    await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
    })

    expect(current.deleted).toBe(false)
  })

  it('keeps a sandbox whose version read fails — a transient command failure is not drift', async () => {
    const unreadable = fakeSandbox({ versionReadFails: true })
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      driveSdk: fakeDriveSdk().sdk,
      image: `atlas-sandbox:${PINNED_VERSION}`,
      serveVersion: PINNED_VERSION,
      sdk: { get: async () => unreadable, getOrCreate: async () => unreadable },
    })

    await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
    })

    expect(unreadable.deleted).toBe(false)
  })

  it('rotates a running outdated sandbox regardless of attached clients', async () => {
    const stale = fakeSandbox({ installedVersion: '1.19.1', status: 'running' })
    const lines: string[] = []
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      driveSdk: fakeDriveSdk().sdk,
      image: `atlas-sandbox:${PINNED_VERSION}`,
      serveVersion: PINNED_VERSION,
      log: (line) => lines.push(line),
      runtimeHealth: async () => ({
        busy: false,
        childrenRunning: 0,
        shellsRunning: 0,
        servicesRunning: 0,
        pendingInput: false,
        settlingWork: false,
        clients: 1,
      }),
      sdk: { get: async () => stale, getOrCreate: async () => stale },
    })

    const placement = await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
    })

    expect(stale.deleted).toBe(false)
    expect(placement.rotatedFrom).toBe('1.19.1')
    expect(
      lines.some(
        (line) =>
          line.includes('carries serve "1.19.1"') &&
          line.includes(`outdated against this build's pinned "${PINNED_VERSION}"`),
      ),
    ).toBe(true)
  })

  it('keeps a matching-version sandbox without ever reading its health', async () => {
    const current = fakeSandbox({ installedVersion: PINNED_VERSION })
    const lines: string[] = []
    let healthReads = 0
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      driveSdk: fakeDriveSdk().sdk,
      image: `atlas-sandbox:${PINNED_VERSION}`,
      serveVersion: PINNED_VERSION,
      log: (line) => lines.push(line),
      runtimeHealth: async () => {
        healthReads += 1
        return undefined
      },
      sdk: { get: async () => current, getOrCreate: async () => current },
    })

    const placement = await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
    })

    expect(current.deleted).toBe(false)
    expect(placement.rotatedFrom).toBeUndefined()
    expect(healthReads).toBe(0)
  })
})
