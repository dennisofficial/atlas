import { describe, expect, it } from 'bun:test'

import { DRIVE_HOME_PATH } from '@dltech/atlas-wire'
import { VercelDriver } from '../vercel-driver'
import {
  CREDENTIALS,
  PINNED_VERSION,
  fakeSandbox,
  fakeDriveSdk,
  driverWith,
  notFound,
  ERecordedCallKind,
  type RecordedCall,
} from './vercel-driver-fixture'

describe('createOrResume', () => {
  it('passes the configured vcpu count to the create call, and none when unset', async () => {
    const seen: (number | undefined)[] = []
    const driverSized = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      image: `atlas-sandbox:${PINNED_VERSION}`,
      vcpus: 4,
      attachLagRetry: { attempts: 10, delayMs: 0 },
      driveSdk: fakeDriveSdk().sdk,
      sdk: {
        get: async () => {
          throw notFound()
        },
        getOrCreate: async (params) => {
          seen.push(params?.resources?.vcpus)
          return fakeSandbox()
        },
      },
    })
    await driverSized.createOrResume({ name: 'atlas-thread-x', threadId: 'brn_cloud', token: 't' })

    const { driver: driverDefault } = driverWith({
      sdk: {
        get: async () => {
          throw notFound()
        },
        getOrCreate: async (params) => {
          seen.push(params?.resources?.vcpus)
          return fakeSandbox()
        },
      },
    })
    await driverDefault.createOrResume({ name: 'atlas-thread-x', threadId: 'brn_cloud', token: 't' })

    expect(seen).toEqual([4, undefined])
  })

  it('writes the bootstrap onto a fresh sandbox after it exists, before serve launches', async () => {
    const calls: string[] = []
    const { driver } = driverWith({
      sdk: {
        get: async () => {
          throw notFound()
        },
        getOrCreate: async (params) => {
          calls.push('boot')
          const sandbox = fakeSandbox()
          await params?.onCreate?.(sandbox)
          return sandbox
        },
      },
    })

    await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
      putContextOnFreshBoot: async () => {
        calls.push('put-context')
      },
    })

    expect(calls).toEqual(['boot', 'put-context'])
  })

  it('swaps serve on a drifted sandbox in place, re-uploading context without recreating it', async () => {
    const stale = fakeSandbox({ installedVersion: '1.19.1', status: 'stopped' })
    const calls: string[] = []
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
        getOrCreate: async () => {
          calls.push('boot')
          return fakeSandbox({ installedVersion: PINNED_VERSION })
        },
      },
    })

    await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
      putContextOnFreshBoot: async () => {
        calls.push('put-context')
      },
    })

    expect(stale.deleted).toBe(false)
    expect(calls).toEqual(['boot', 'put-context'])
  })

  it('re-uploads the context archive when the sandbox resumes, since the local context may have moved on', async () => {
    const current = fakeSandbox({ installedVersion: PINNED_VERSION })
    let uploads = 0
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
      putContextOnFreshBoot: async () => {
        uploads += 1
      },
    })

    expect(uploads).toBe(1)
    expect(current.deleted).toBe(false)
  })

  it('completes the bootstrap callback before serve launches on a fresh sandbox', async () => {
    const calls: RecordedCall[] = []
    const { driver } = driverWith({
      sdk: {
        get: async () => {
          throw notFound()
        },
        getOrCreate: async (params) => {
          const sandbox = fakeSandbox({ calls })
          await params?.onCreate?.(sandbox)
          return sandbox
        },
      },
    })

    await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 'serve-token-1',
      putContextOnFreshBoot: async (sandbox) => {
        await driver.writeBootstrapFileToSandbox({ sandbox, path: 'context.tar.gz', content: 'x' })
      },
    })

    const bootstrapEnd = calls.findIndex(
      (call) => call.kind === ERecordedCallKind.Write && call.path === 'context.tar.gz',
    )
    const tokenStage = calls.findIndex(
      (call) =>
        call.kind === ERecordedCallKind.Command && call.script.startsWith('mkdir -p /opt/atlas'),
    )
    const health = calls.findIndex(
      (call) => call.kind === ERecordedCallKind.Command && call.script.includes('/v1/health'),
    )
    expect(bootstrapEnd).toBeGreaterThanOrEqual(0)
    expect(tokenStage).toBeGreaterThanOrEqual(0)
    expect(health).toBeGreaterThanOrEqual(0)
    expect(bootstrapEnd).toBeLessThan(tokenStage)
    expect(bootstrapEnd).toBeLessThan(health)
  })

  it('completes the bootstrap callback before serve launches when the SDK fires onResume', async () => {
    const calls: RecordedCall[] = []
    const sandbox = fakeSandbox({ calls })
    const { driver } = driverWith({
      sdk: {
        get: async () => {
          throw notFound()
        },
        getOrCreate: async (params) => {
          await params?.onResume?.(sandbox)
          return sandbox
        },
      },
    })

    await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 'serve-token-1',
      putContextOnFreshBoot: async (resumed) => {
        await driver.writeBootstrapFileToSandbox({
          sandbox: resumed,
          path: 'context.tar.gz',
          content: 'x',
        })
      },
    })

    const bootstrapEnd = calls.findIndex(
      (call) => call.kind === ERecordedCallKind.Write && call.path === 'context.tar.gz',
    )
    const tokenStage = calls.findIndex(
      (call) =>
        call.kind === ERecordedCallKind.Command && call.script.startsWith('mkdir -p /opt/atlas'),
    )
    const health = calls.findIndex(
      (call) => call.kind === ERecordedCallKind.Command && call.script.includes('/v1/health'),
    )
    expect(bootstrapEnd).toBeGreaterThanOrEqual(0)
    expect(tokenStage).toBeGreaterThanOrEqual(0)
    expect(health).toBeGreaterThanOrEqual(0)
    expect(bootstrapEnd).toBeLessThan(tokenStage)
    expect(bootstrapEnd).toBeLessThan(health)
  })

  it('never launches serve when the bootstrap callback fails, on a resumed sandbox', async () => {
    const calls: RecordedCall[] = []
    const sandbox = fakeSandbox({ calls })
    const { driver } = driverWith({
      sdk: {
        getOrCreate: async (params) => {
          await params?.onResume?.(sandbox)
          return sandbox
        },
      },
    })

    await expect(
      driver.createOrResume({
        name: 'atlas-thread-x',
        threadId: 'brn_cloud',
        token: 'serve-token-1',
        putContextOnFreshBoot: async () => {
          throw new Error('context upload failed')
        },
      }),
    ).rejects.toThrow('context upload failed')

    expect(
      calls.some(
        (call) =>
          call.kind === ERecordedCallKind.Command && call.script.startsWith('mkdir -p /opt/atlas'),
      ),
    ).toBe(false)
    expect(
      calls.some(
        (call) => call.kind === ERecordedCallKind.Command && call.script.includes('/v1/health'),
      ),
    ).toBe(false)
    expect(sandbox.written).toEqual([])
  })

  it('never launches serve when the bootstrap callback fails, on a fresh sandbox', async () => {
    const calls: RecordedCall[] = []
    const { driver } = driverWith({
      sdk: {
        get: async () => {
          throw notFound()
        },
        getOrCreate: async (params) => {
          const sandbox = fakeSandbox({ calls })
          await params?.onCreate?.(sandbox)
          return sandbox
        },
      },
    })

    await expect(
      driver.createOrResume({
        name: 'atlas-thread-x',
        threadId: 'brn_cloud',
        token: 'serve-token-1',
        putContextOnFreshBoot: async () => {
          throw new Error('context upload failed')
        },
      }),
    ).rejects.toThrow('context upload failed')

    expect(
      calls.some(
        (call) =>
          call.kind === ERecordedCallKind.Command && call.script.startsWith('mkdir -p /opt/atlas'),
      ),
    ).toBe(false)
    expect(
      calls.some(
        (call) => call.kind === ERecordedCallKind.Command && call.script.includes('/v1/health'),
      ),
    ).toBe(false)
  })

  it('stages bootstrap files with mode 0600 on the drive bootstrap directory', async () => {
    const sandbox = fakeSandbox()
    const { driver } = driverWith({ sdk: { get: async () => sandbox } })

    await driver.writeBootstrapFileToSandbox({
      sandbox,
      path: 'workspace-spec.json',
      content: new Uint8Array([1, 2, 3]),
    })

    expect(sandbox.written).toEqual([
      { path: 'workspace-spec.json', content: new Uint8Array([1, 2, 3]), mode: 0o600 },
    ])
    expect(
      sandbox.commands.some((script) => script === `mkdir -p ${DRIVE_HOME_PATH}/bootstrap`),
    ).toBe(true)
  })
})
