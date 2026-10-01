import { describe, expect, it } from 'bun:test'

import { APIError, Sandbox } from '@vercel/sandbox'

import { driveNameFor, DRIVE_MOUNT_PATH, DRIVE_WORKSPACE_PATH, DRIVE_HOME_PATH } from '../drive-names'
import type { DriveSdk } from '../drive-lifecycle'
import { ECloudSandboxState } from '../sandbox-client'
import { SERVE_TOKEN_PATH } from '../serve-launch'
import { VercelDriver, type VercelSdk } from '../vercel-driver'
import { EVercelFailure, SandboxMissingError, VercelFailure } from '../vercel-errors'

const CREDENTIALS = { token: 'vercel-token', teamId: 'team_1', projectId: 'prj_1' }
const PINNED_VERSION = '1.19.2'

/** A fake drive: the SDK's Drive is a class with a private client, so specs stand one up by shape. */
const fakeDrive = (name: string, deleted?: string[]) =>
  ({
    name,
    delete: async () => {
      deleted?.push(name)
    },
  }) as never

const fakeDriveSdk = (over: Partial<DriveSdk> = {}): { sdk: DriveSdk; created: string[]; deleted: string[] } => {
  const created: string[] = []
  const deleted: string[] = []
  return {
    created,
    deleted,
    sdk: {
      getOrCreate: async (params) => {
        created.push(params?.name ?? '')
        return fakeDrive(params?.name ?? '', deleted)
      },
      list: async () => (async function* () {
        yield* [] as never[]
      })(),
      ...over,
    },
  }
}

type RecordedWrite = { path: string; content: Uint8Array | string; mode?: number }

type FakeSandboxExtras = {
  readonly commands: readonly string[]
  readonly written: readonly RecordedWrite[]
  readonly updates: readonly number[][]
  readonly stopped: boolean
  readonly deleted: boolean
}

type FakeSandbox = Sandbox & FakeSandboxExtras

type RecordedCall =
  | { kind: 'command'; script: string }
  | { kind: 'write'; path: string }

const fakeSandbox = (
  args: {
    status?: string
    routes?: number[]
    installedVersion?: string
    versionReadFails?: boolean
    healthy?: boolean
    alive?: boolean
    calls?: RecordedCall[]
  } = {},
): FakeSandbox => {
  const commands: string[] = []
  const written: RecordedWrite[] = []
  const updates: number[][] = []
  const calls = args.calls
  const routedPorts = [...(args.routes ?? [3000])]
  let stopped = false
  let deleted = false

  const base = {
    name: 'atlas-thread-x',
    status: args.status ?? 'running',
    routes: (args.routes ?? [3000]).map((port) => ({ port, subdomain: `sb-${port}` })),
    currentSession: () => ({ sessionId: 'session-1' }),
    domain: (port: number) => {
      const status = args.status ?? 'running'
      const routable = status === 'running' || status === 'pending' || status === 'stopped'
      if (!routedPorts.includes(port) || !routable) {
        throw new Error('no route')
      }
      return `https://sb-${port}.vercel.run`
    },
    runCommand: async (params: { cmd: string; args?: string[] }) => {
      const script = params.args?.[1] ?? params.cmd
      commands.push(script)
      calls?.push({ kind: 'command', script })
      if (script.startsWith('rm -f')) return { exitCode: 0, stdout: async () => '', stderr: async () => '' }
      if (script.startsWith('kill -0')) {
        return { exitCode: args.alive === true ? 0 : 1 }
      }
      if (script.startsWith('[ ! -s')) return { exitCode: 0 }
      const isVersionRead = script.includes('.version')
      if (isVersionRead) {
        if (args.versionReadFails && script.startsWith('cat ')) throw new Error('runCommand unavailable')
        return { exitCode: 0, stdout: async () => `${args.installedVersion ?? PINNED_VERSION}\n`, stderr: async () => '' }
      }
      if (script.startsWith('for i in')) return { exitCode: 0 }
      if (script.startsWith('mkdir ')) return { exitCode: 0 }
      if (script.startsWith('tail -c')) return { exitCode: 0, stdout: async () => '', stderr: async () => '' }
      const healthy = args.healthy ?? true
      return { exitCode: healthy ? 0 : 1, stderr: async () => '' }
    },
    writeFiles: async (files: RecordedWrite[]) => {
      written.push(...files)
      files.forEach((file) => calls?.push({ kind: 'write', path: file.path }))
    },
    update: async (params: { ports: number[] }) => {
      updates.push(params.ports)
      routedPorts.splice(0, routedPorts.length, ...params.ports)
    },
    stop: async () => {
      stopped = true
    },
    delete: async () => {
      deleted = true
    },
  }

  const sandbox = base as unknown as FakeSandbox
  Object.defineProperties(sandbox, {
    commands: { get: () => commands },
    written: { get: () => written },
    updates: { get: () => updates },
    stopped: { get: () => stopped },
    deleted: { get: () => deleted },
  })
  return sandbox
}

const notFound = (): APIError<unknown> =>
  new APIError(new Response(null, { status: 404 }), { message: 'sandbox not found' })

const alreadyAttachedError = (): APIError<unknown> =>
  new APIError(new Response(null, { status: 409 }), {
    json: {
      error: {
        message:
          'Drive `atlas-drive-abc` is already attached as read-write to sandbox atlas-thread-abc',
      },
    },
  })

const driverWith = (
  sdk: Partial<VercelSdk>,
  driveSdk?: DriveSdk,
): { driver: VercelDriver } => ({
  driver: new VercelDriver({
    credentials: CREDENTIALS,
    cloudUrl: 'https://api.example.com',
    image: `atlas-sandbox:${PINNED_VERSION}`,
    serveVersion: PINNED_VERSION,
    attachLagRetry: { attempts: 10, delayMs: 0 },
    driveSdk: driveSdk ?? fakeDriveSdk().sdk,
    sdk: {
      getOrCreate: sdk.getOrCreate ?? (async () => fakeSandbox()),
      get: sdk.get ?? (async () => fakeSandbox()),
    },
  }),
})

describe('createOrResume', () => {
  it('creates with the operator credentials, the serve environment, and the fixed timeout', async () => {
    let seen: Record<string, unknown> = {}
    const sandbox = fakeSandbox()
    const { driver } = driverWith({
      getOrCreate: async (params) => {
        seen = params as Record<string, unknown>
        await params?.onCreate?.(sandbox)
        return sandbox
      },
    })

    const placement = await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 'serve-token-1',
    })

    expect(seen).toMatchObject({
      ...CREDENTIALS,
      name: 'atlas-thread-x',
      ports: [3000],
      timeout: 4 * 60 * 60 * 1000,
      region: 'iad1',
      persistent: true,
      resume: true,
      image: `atlas-sandbox:${PINNED_VERSION}`,
      env: {
        ATLAS_SERVE_TOKEN: 'serve-token-1',
        ATLAS_SERVE_PORT: '3000',
        ATLAS_THREAD_ID: 'brn_cloud',
        ATLAS_CLOUD_URL: 'https://api.example.com',
        ATLAS_WORKSPACE_DIR: DRIVE_WORKSPACE_PATH,
        ATLAS_HOME: DRIVE_HOME_PATH,
        VERCEL_TOKEN: CREDENTIALS.token,
        VERCEL_TEAM_ID: CREDENTIALS.teamId,
        VERCEL_PROJECT_ID: CREDENTIALS.projectId,
      },
    })
    expect(placement).toEqual({
      sessionId: 'session-1',
      url: 'https://sb-3000.vercel.run',
      state: ECloudSandboxState.Running,
      created: true,
      driveName: driveNameFor({ threadId: 'brn_cloud' }),
      token: 'serve-token-1',
    })
  })

  it('merges a caller environment into the sandbox env after the fixed entries', async () => {
    let seen: Record<string, unknown> = {}
    const sandbox = fakeSandbox()
    const { driver } = driverWith({
      getOrCreate: async (params) => {
        seen = params as Record<string, unknown>
        await params?.onCreate?.(sandbox)
        return sandbox
      },
    })

    await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 'serve-token-1',
      environment: {
        ATLAS_DECISIONS_URL: 'https://api.typesafe.ai',
        ATLAS_CLASSIFIER_MODE: 'nudge',
        ATLAS_SEARCH_BACKEND: 'brave',
      },
    })

    expect(seen.env).toMatchObject({
      ATLAS_SERVE_TOKEN: 'serve-token-1',
      ATLAS_DECISIONS_URL: 'https://api.typesafe.ai',
      ATLAS_CLASSIFIER_MODE: 'nudge',
      ATLAS_SEARCH_BACKEND: 'brave',
    })
  })

  it('boots with no caller environment when none is handed', async () => {
    let seen: Record<string, unknown> = {}
    const sandbox = fakeSandbox()
    const { driver } = driverWith({
      getOrCreate: async (params) => {
        seen = params as Record<string, unknown>
        await params?.onCreate?.(sandbox)
        return sandbox
      },
    })

    await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 'serve-token-1',
    })

    expect(seen.env).not.toHaveProperty('ATLAS_DECISIONS_URL')
  })

  it('hands the serve token to the sandbox through writeFiles and nothing larger', async () => {
    const sandbox = fakeSandbox()
    const { driver } = driverWith({
      getOrCreate: async (params) => {
        await params?.onCreate?.(sandbox)
        return sandbox
      },
    })

    await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 'serve-token-1',
    })

    expect(sandbox.written).toEqual([
      { path: SERVE_TOKEN_PATH, content: 'serve-token-1', mode: 0o600 },
    ])
  })

  it('mints the serve token on this machine when the caller hands none', async () => {
    const sandbox = fakeSandbox()
    let seen: Record<string, unknown> = {}
    const { driver } = driverWith({
      getOrCreate: async (params) => {
        seen = params as Record<string, unknown>
        await params?.onCreate?.(sandbox)
        return sandbox
      },
    })

    await driver.createOrResume({ name: 'atlas-thread-x', threadId: 'brn_cloud' })

    const minted = seen.env as Record<string, string>
    const token = minted.ATLAS_SERVE_TOKEN ?? ''
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(sandbox.written).toEqual([{ path: SERVE_TOKEN_PATH, content: token, mode: 0o600 }])
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
    expect(unpinned.commands.some((script) => script.includes('.version'))).toBe(false)
  })

  it('resumes an existing sandbox without the created flag, staging the serve token', async () => {
    const sandbox = fakeSandbox()
    let resumeCalls = 0
    const { driver } = driverWith({
      getOrCreate: async (params) => {
        await params?.onResume?.(sandbox)
        resumeCalls += 1
        return sandbox
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

  it('preserves a live running sandbox whose baked serve predates the pinned version — a reconnect never kills a runtime', async () => {
    const stale = fakeSandbox({ installedVersion: '1.19.1', status: 'running' })
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      driveSdk: fakeDriveSdk().sdk,
      image: `atlas-sandbox:${PINNED_VERSION}`,
      serveVersion: PINNED_VERSION,
      sdk: {
        get: async () => stale,
        getOrCreate: async () => stale,
      },
    })

    const placement = await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
    })

    expect(stale.deleted).toBe(false)
    expect(placement.created).toBe(false)
    expect(placement.outdatedServe).toBe('1.19.1')
  })

  it('recreates a stopped sandbox whose baked serve predates the pin once health proves it fully idle', async () => {
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

  it('keeps a stopped outdated sandbox that still has a client attached, naming the field that preserved it', async () => {
    const stale = fakeSandbox({ installedVersion: '1.19.1', status: 'stopped' })
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
    expect(placement.created).toBe(false)
    expect(placement.outdatedServe).toBe('1.19.1')
    expect(
      lines.some(
        (line) =>
          line.includes('carries serve "1.19.1"') &&
          line.includes(`wants "${PINNED_VERSION}"`) &&
          line.includes('clients=1'),
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
    expect(placement.outdatedServe).toBeUndefined()
    expect(healthReads).toBe(0)
    expect(lines.some((line) => line.includes('never proved idle'))).toBe(false)
  })

  it('writes the bootstrap onto a fresh sandbox after it exists, before serve launches', async () => {
    const calls: string[] = []
    const { driver } = driverWith({
      get: async () => {
        throw notFound()
      },
      getOrCreate: async (params) => {
        calls.push('boot')
        const sandbox = fakeSandbox()
        await params?.onCreate?.(sandbox)
        return sandbox
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

  it('writes the bootstrap onto a drift-replaced sandbox after it exists, before serve launches', async () => {
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

    expect(stale.deleted).toBe(true)
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
      get: async () => {
        throw notFound()
      },
      getOrCreate: async (params) => {
        const sandbox = fakeSandbox({ calls })
        await params?.onCreate?.(sandbox)
        return sandbox
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

    const bootstrapEnd = calls.findIndex((call) => call.kind === 'write' && call.path === 'context.tar.gz')
    const tokenStage = calls.findIndex(
      (call) => call.kind === 'command' && call.script.startsWith('mkdir -p /opt/atlas'),
    )
    const health = calls.findIndex(
      (call) => call.kind === 'command' && call.script.includes('/v1/health'),
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
      get: async () => {
        throw notFound()
      },
      getOrCreate: async (params) => {
        await params?.onResume?.(sandbox)
        return sandbox
      },
    })

    await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 'serve-token-1',
      putContextOnFreshBoot: async (resumed) => {
        await driver.writeBootstrapFileToSandbox({ sandbox: resumed, path: 'context.tar.gz', content: 'x' })
      },
    })

    const bootstrapEnd = calls.findIndex((call) => call.kind === 'write' && call.path === 'context.tar.gz')
    const tokenStage = calls.findIndex(
      (call) => call.kind === 'command' && call.script.startsWith('mkdir -p /opt/atlas'),
    )
    const health = calls.findIndex(
      (call) => call.kind === 'command' && call.script.includes('/v1/health'),
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
      getOrCreate: async (params) => {
        await params?.onResume?.(sandbox)
        return sandbox
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

    expect(calls.some((call) => call.kind === 'command' && call.script.startsWith('mkdir -p /opt/atlas'))).toBe(
      false,
    )
    expect(calls.some((call) => call.kind === 'command' && call.script.includes('/v1/health'))).toBe(false)
    expect(sandbox.written).toEqual([])
  })

  it('never launches serve when the bootstrap callback fails, on a fresh sandbox', async () => {
    const calls: RecordedCall[] = []
    const { driver } = driverWith({
      get: async () => {
        throw notFound()
      },
      getOrCreate: async (params) => {
        const sandbox = fakeSandbox({ calls })
        await params?.onCreate?.(sandbox)
        return sandbox
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

    expect(calls.some((call) => call.kind === 'command' && call.script.startsWith('mkdir -p /opt/atlas'))).toBe(
      false,
    )
    expect(calls.some((call) => call.kind === 'command' && call.script.includes('/v1/health'))).toBe(false)
  })

  it('stages bootstrap files with mode 0600 on the drive bootstrap directory', async () => {
    const sandbox = fakeSandbox()
    const { driver } = driverWith({ get: async () => sandbox })

    await driver.writeBootstrapFileToSandbox({
      sandbox,
      path: 'workspace-spec.json',
      content: new Uint8Array([1, 2, 3]),
    })

    expect(sandbox.written).toEqual([{ path: 'workspace-spec.json', content: new Uint8Array([1, 2, 3]), mode: 0o600 }])
    expect(sandbox.commands.some((script) => script === `mkdir -p ${DRIVE_HOME_PATH}/bootstrap`)).toBe(true)
  })

  it('pins the model into the environment only when one is pinned', async () => {
    const seen: Record<string, unknown>[] = []
    const { driver } = driverWith({
      getOrCreate: async (params) => {
        seen.push((params?.env ?? {}) as Record<string, unknown>)
        return fakeSandbox()
      },
    })

    await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
      pinnedModel: 'anthropic/claude-opus-4.8',
    })
    await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
    })

    expect(seen[0]?.ATLAS_MODEL).toBe('anthropic/claude-opus-4.8')
    expect(seen[1]?.ATLAS_MODEL).toBeUndefined()
  })

  it('provisions the thread drive, mounts it, and points serve at the drive paths', async () => {
    let seen: Record<string, unknown> = {}
    const drives = fakeDriveSdk()
    const { driver } = driverWith(
      {
        getOrCreate: async (params) => {
          seen = params as Record<string, unknown>
          await params?.onCreate?.(fakeSandbox())
          return fakeSandbox()
        },
      },
      drives.sdk,
    )

    const placement = await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
    })

    const driveName = driveNameFor({ threadId: 'brn_cloud' })
    expect(drives.created).toEqual([driveName])
    expect(placement.driveName).toBe(driveName)
    expect(seen.mounts).toMatchObject({ [DRIVE_MOUNT_PATH]: { name: driveName } })
    expect(seen.env).toMatchObject({
      ATLAS_WORKSPACE_DIR: DRIVE_WORKSPACE_PATH,
      ATLAS_HOME: DRIVE_HOME_PATH,
    })
  })

  it('retries the mount through the attach-detach lag until the drive is free', async () => {
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
          if (calls < 3) throw alreadyAttachedError()
          return fakeSandbox()
        },
      },
    })

    const placement = await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
    })

    expect(calls).toBe(3)
    expect(placement.created).toBe(false)
    expect(lines.some((line) => line.includes('still attached'))).toBe(true)
  })

  it('waits out a drive that stays attached for a few polls after the stale sandbox is deleted', async () => {
    const stale = fakeSandbox({ installedVersion: '1.19.1', status: 'stopped' })
    let listCalls = 0
    const drives = fakeDriveSdk({
      list: async () => (async function* () {
        listCalls += 1
        if (listCalls < 3) {
          yield { name: 'other-drive', currentSandboxName: 'atlas-thread-y' } as never
          return
        }
        yield* [] as never[]
      })(),
    })
    let mounts = 0
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      driveSdk: drives.sdk,
      image: `atlas-sandbox:${PINNED_VERSION}`,
      serveVersion: PINNED_VERSION,
      attachLagRetry: { attempts: 10, delayMs: 0 },
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
          mounts += 1
          return fakeSandbox()
        },
      },
    })

    await driver.createOrResume({ name: 'atlas-thread-x', threadId: 'brn_cloud', token: 't' })

    expect(stale.deleted).toBe(true)
    expect(listCalls).toBe(1)
    expect(mounts).toBe(1)
  })

  it('exhausts the mount retries into a typed drive-attached failure', async () => {
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
          throw alreadyAttachedError()
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
    expect((failure as VercelFailure).kind).toBe(EVercelFailure.DriveAttached)
    expect((failure as VercelFailure).message).toContain('already attached')
  })

  it('does not retry a create failure that is not the attach lag', async () => {
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
          throw new Error('quota exceeded')
        },
      },
    })

    await expect(
      driver.createOrResume({ name: 'atlas-thread-x', threadId: 'brn_cloud', token: 't' }),
    ).rejects.toThrow('quota exceeded')
    expect(calls).toBe(1)
  })
})

describe('inspect', () => {
  it('maps the sdk statuses onto the wire states, carrying the sandbox session identity', async () => {
    const { driver } = driverWith({ get: async () => fakeSandbox({ status: 'running' }) })
    expect(await driver.inspect({ name: 'x' })).toEqual({
      state: ECloudSandboxState.Running,
      url: 'https://sb-3000.vercel.run',
      sandboxSessionId: 'session-1',
    })

    const pending = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      sdk: { get: async () => fakeSandbox({ status: 'pending' }), getOrCreate: async () => fakeSandbox() },
    })
    expect(await pending.inspect({ name: 'x' })).toEqual({
      state: ECloudSandboxState.Resuming,
      url: 'https://sb-3000.vercel.run',
      sandboxSessionId: 'session-1',
    })

    const stopped = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      sdk: { get: async () => fakeSandbox({ status: 'stopped' }), getOrCreate: async () => fakeSandbox() },
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
      get: async () => {
        throw notFound()
      },
    })

    expect(await driver.inspect({ name: 'x' })).toBeUndefined()
  })

  it('rethrows a failure that is not a missing sandbox', async () => {
    const { driver } = driverWith({
      get: async () => {
        throw new APIError(new Response(null, { status: 401 }), { message: 'bad token' })
      },
    })

    await expect(driver.inspect({ name: 'x' })).rejects.toThrow()
  })
})

describe('exposePort', () => {
  it('grows the routed list rather than replacing it, and answers the domain', async () => {
    const sandbox = fakeSandbox({ routes: [3000, 3001] })
    const { driver } = driverWith({ get: async () => sandbox })

    const url = await driver.exposePort({ name: 'x', port: 3002 })

    expect(sandbox.updates).toEqual([[3000, 3001, 3002]])
    expect(url).toBe('https://sb-3002.vercel.run')
  })

  it('does not touch the routes when the port is already exposed', async () => {
    const sandbox = fakeSandbox({ routes: [3000, 3001] })
    const { driver } = driverWith({ get: async () => sandbox })

    await driver.exposePort({ name: 'x', port: 3001 })

    expect(sandbox.updates).toEqual([])
  })

  it('refuses at the port ceiling before asking Vercel for anything', async () => {
    const sandbox = fakeSandbox({ routes: Array.from({ length: 15 }, (_, i) => 3000 + i) })
    const { driver } = driverWith({ get: async () => sandbox })

    await expect(driver.exposePort({ name: 'x', port: 4000 })).rejects.toThrow('at most 15 ports')
    expect(sandbox.updates).toEqual([])
  })

  it('reads a missing sandbox as gone', async () => {
    const { driver } = driverWith({
      get: async () => {
        throw notFound()
      },
    })

    await expect(driver.exposePort({ name: 'x', port: 3002 })).rejects.toBeInstanceOf(
      SandboxMissingError,
    )
  })
})

describe('stop and destroy', () => {
  it('stops the sandbox and tolerates one already gone', async () => {
    const sandbox = fakeSandbox()
    const { driver } = driverWith({ get: async () => sandbox })
    await driver.stop({ name: 'x' })
    expect(sandbox.stopped).toBe(true)

    const missing = driverWith({
      get: async () => {
        throw notFound()
      },
    })
    await expect(missing.driver.stop({ name: 'x' })).resolves.toBeUndefined()
  })

  it('stops the sandbox when the caller holds its live session identity', async () => {
    const sandbox = fakeSandbox()
    const { driver } = driverWith({ get: async () => sandbox })

    await driver.stop({ name: 'x', sessionId: 'session-1' })

    expect(sandbox.stopped).toBe(true)
  })

  it('refuses to stop a sandbox whose live session is not the one the stop was issued for', async () => {
    const sandbox = fakeSandbox()
    const { driver } = driverWith({ get: async () => sandbox })

    await expect(driver.stop({ name: 'x', sessionId: 'session-old' })).rejects.toThrow(
      'refusing to stop sandbox x',
    )

    expect(sandbox.stopped).toBe(false)
  })

  it('deletes the sandbox and tolerates one already gone', async () => {
    const sandbox = fakeSandbox()
    const { driver } = driverWith({ get: async () => sandbox })
    await driver.destroy({ name: 'x' })
    expect(sandbox.deleted).toBe(true)

    const missing = driverWith({
      get: async () => {
        throw notFound()
      },
    })
    await expect(missing.driver.destroy({ name: 'x' })).resolves.toBeUndefined()
  })

  it('deletes the thread drive after the sandbox is gone', async () => {
    const sandbox = fakeSandbox()
    const driveName = driveNameFor({ threadId: 'brn_cloud' })
    const drives = fakeDriveSdk({
      list: async () => (async function* () {
        yield fakeDrive(driveName, drivesDeleted)
      })(),
    })
    const drivesDeleted: string[] = []
    const { driver } = driverWith({ get: async () => sandbox }, drives.sdk)

    await driver.destroy({ name: 'x', threadId: 'brn_cloud' })

    expect(sandbox.deleted).toBe(true)
    expect(drivesDeleted).toEqual([driveName])
  })

  it('leaves the drive alone when destroy is not told the thread', async () => {
    const sandbox = fakeSandbox()
    const drives = fakeDriveSdk()
    const { driver } = driverWith({ get: async () => sandbox }, drives.sdk)

    await driver.destroy({ name: 'x' })

    expect(sandbox.deleted).toBe(true)
    expect(drives.deleted).toEqual([])
  })

  it('waits for the drive to detach before deleting it', async () => {
    const sandbox = fakeSandbox()
    const driveName = driveNameFor({ threadId: 'brn_cloud' })
    const events: string[] = []
    // Vercel detaches the drive asynchronously once its sandbox is gone. Until the detach has
    // been observed the drive refuses to delete with a 409, so destroy must wait the detach out
    // rather than attempt the delete while the drive still reads attached.
    let listCalls = 0
    const sdk: DriveSdk = {
      getOrCreate: async () => fakeDrive(driveName),
      list: async () => (async function* () {
        listCalls += 1
        const attached = !sandbox.deleted || listCalls < 3
        yield {
          name: driveName,
          currentSandboxName: attached ? 'atlas-thread-x' : undefined,
          delete: async () => {
            if (attached) {
              events.push('delete-while-attached')
              throw new APIError(new Response(null, { status: 409 }), {
                json: { error: { message: 'Cannot delete a drive that is currently attached to a sandbox.' } },
              })
            }
            events.push('delete-drive')
          },
        } as never
      })(),
    }
    const { driver } = driverWith({ get: async () => sandbox }, sdk)

    await driver.destroy({ name: 'x', threadId: 'brn_cloud' })

    expect(sandbox.deleted).toBe(true)
    expect(events).toEqual(['delete-drive'])
  })

  it('still attempts the drive delete when the detach outlives the wait', async () => {
    const sandbox = fakeSandbox()
    const driveName = driveNameFor({ threadId: 'brn_cloud' })
    let deleteCalls = 0
    const attachedDrive = {
      name: driveName,
      currentSandboxName: 'atlas-thread-x',
      delete: async () => {
        deleteCalls += 1
        throw new APIError(new Response(null, { status: 409 }), {
          json: { error: { message: 'Cannot delete a drive that is currently attached to a sandbox.' } },
        })
      },
    }
    const sdk: DriveSdk = {
      getOrCreate: async () => fakeDrive(driveName),
      list: async () => (async function* () {
        yield attachedDrive as never
      })(),
    }
    const { driver } = driverWith({ get: async () => sandbox }, sdk)

    await expect(driver.destroy({ name: 'x', threadId: 'brn_cloud' })).rejects.toThrow()

    expect(deleteCalls).toBe(10)
  })
})
