import { describe, expect, it } from 'bun:test'

import { APIError, Sandbox } from '@vercel/sandbox'

import { driveNameFor, DRIVE_MOUNT_PATH, DRIVE_WORKSPACE_PATH, DRIVE_HOME_PATH } from '../drive-names'
import type { DriveSdk } from '../drive-lifecycle'
import { ECloudSandboxState } from '../sandbox-client'
import { SERVE_TOKEN_PATH } from '../serve-launch'
import { VercelDriver, type VercelSdk } from '../vercel-driver'
import { SandboxMissingError } from '../vercel-errors'

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

type RecordedWrite = { path: string; content: string; mode?: number }

type FakeSandboxExtras = {
  readonly commands: readonly string[]
  readonly written: readonly RecordedWrite[]
  readonly updates: readonly number[][]
  readonly stopped: boolean
  readonly deleted: boolean
}

type FakeSandbox = Sandbox & FakeSandboxExtras

const fakeSandbox = (
  args: {
    status?: string
    routes?: number[]
    installedVersion?: string
    versionReadFails?: boolean
    healthy?: boolean
  } = {},
): FakeSandbox => {
  const commands: string[] = []
  const written: RecordedWrite[] = []
  const updates: number[][] = []
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
      if (!routedPorts.includes(port) || (status !== 'running' && status !== 'pending')) {
        throw new Error('no route')
      }
      return `https://sb-${port}.vercel.run`
    },
    runCommand: async (params: { cmd: string; args?: string[] }) => {
      const script = params.args?.[1] ?? params.cmd
      commands.push(script)
      const isVersionRead = script.includes('.version')
      if (isVersionRead) {
        if (args.versionReadFails && script.startsWith('cat ')) throw new Error('runCommand unavailable')
        return { exitCode: 0, stdout: async () => `${args.installedVersion ?? PINNED_VERSION}\n`, stderr: async () => '' }
      }
      if (script.startsWith('for i in')) return { exitCode: 0 }
      if (script.startsWith('mkdir ')) return { exitCode: 0 }
      if (script.startsWith('for pid in')) return { exitCode: 0 }
      if (script.startsWith('tail -c')) return { exitCode: 0, stdout: async () => '', stderr: async () => '' }
      const healthy = args.healthy ?? true
      return { exitCode: healthy ? 0 : 1, stderr: async () => '' }
    },
    writeFiles: async (files: RecordedWrite[]) => {
      written.push(...files)
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

const driverWith = (
  sdk: Partial<VercelSdk>,
  driveSdk?: DriveSdk,
): { driver: VercelDriver } => ({
  driver: new VercelDriver({
    credentials: CREDENTIALS,
    cloudUrl: 'https://api.example.com',
    image: `atlas-sandbox:${PINNED_VERSION}`,
    serveVersion: PINNED_VERSION,
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

  it('resumes an existing sandbox without the created flag, launching serve from onResume', async () => {
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

  it('recreates a live sandbox whose baked serve predates the pinned version', async () => {
    const stale = fakeSandbox({ installedVersion: '1.19.1' })
    const fresh = fakeSandbox({ installedVersion: PINNED_VERSION })
    let getOrCreateParams: Record<string, unknown> | undefined
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      driveSdk: fakeDriveSdk().sdk,
      image: `atlas-sandbox:${PINNED_VERSION}`,
      serveVersion: PINNED_VERSION,
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

  it('recreates a sandbox whose version file is missing — the file ships with the image, so its absence means an older bake', async () => {
    const ancient = fakeSandbox({ installedVersion: '' })
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      driveSdk: fakeDriveSdk().sdk,
      image: `atlas-sandbox:${PINNED_VERSION}`,
      serveVersion: PINNED_VERSION,
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
    const stale = fakeSandbox({ installedVersion: '1.19.1' })
    const calls: string[] = []
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      driveSdk: fakeDriveSdk().sdk,
      image: `atlas-sandbox:${PINNED_VERSION}`,
      serveVersion: PINNED_VERSION,
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
})

describe('inspect', () => {
  it('maps the sdk statuses onto the wire states', async () => {
    const { driver } = driverWith({ get: async () => fakeSandbox({ status: 'running' }) })
    expect(await driver.inspect({ name: 'x' })).toEqual({
      state: ECloudSandboxState.Running,
      url: 'https://sb-3000.vercel.run',
    })

    const pending = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      sdk: { get: async () => fakeSandbox({ status: 'pending' }), getOrCreate: async () => fakeSandbox() },
    })
    expect(await pending.inspect({ name: 'x' })).toEqual({
      state: ECloudSandboxState.Resuming,
      url: 'https://sb-3000.vercel.run',
    })

    const stopped = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      sdk: { get: async () => fakeSandbox({ status: 'stopped' }), getOrCreate: async () => fakeSandbox() },
    })
    expect(await stopped.inspect({ name: 'x' })).toEqual({ state: ECloudSandboxState.Parked })
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
})
