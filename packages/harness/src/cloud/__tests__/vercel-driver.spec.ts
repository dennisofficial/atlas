import { describe, expect, it } from 'bun:test'

import { APIError, Sandbox } from '@vercel/sandbox'

import { ECloudSandboxState } from '../sandbox-client'
import { SERVE_TOKEN_PATH } from '../serve-launch'
import { VercelDriver, type VercelSdk } from '../vercel-driver'
import { SandboxMissingError } from '../vercel-errors'

const CREDENTIALS = { token: 'vercel-token', teamId: 'team_1', projectId: 'prj_1' }
const STAMP = 'stamp-1'

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
    installedStamp?: string
    stampReadFails?: boolean
  } = {},
): FakeSandbox => {
  const commands: string[] = []
  const written: RecordedWrite[] = []
  const updates: number[][] = []
  const routedPorts = [...(args.routes ?? [3000])]
  let stopped = false
  let deleted = false
  let stampReads = 0

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
      const isStampRead = script.includes('.stamp')
      if (isStampRead) stampReads += 1
      if (args.stampReadFails && isStampRead && stampReads === 1) {
        throw new Error('runCommand unavailable')
      }
      return {
        exitCode: 0,
        stdout: async () => (script.includes('.stamp') ? `${args.installedStamp ?? STAMP}\n` : ''),
        stderr: async () => '',
      }
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

const driverWith = (sdk: Partial<VercelSdk>): { driver: VercelDriver } => ({
  driver: new VercelDriver({
    credentials: CREDENTIALS,
    cloudUrl: 'https://api.example.com',
    image: 'atlas-sandbox:latest',
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
      readStamps: async () => ({ install: STAMP, acceptable: [STAMP] }),
    })

    expect(seen).toMatchObject({
      ...CREDENTIALS,
      name: 'atlas-thread-x',
      ports: [3000],
      timeout: 4 * 60 * 60 * 1000,
      region: 'iad1',
      persistent: true,
      resume: true,
      image: 'atlas-sandbox:latest',
      env: {
        ATLAS_SERVE_TOKEN: 'serve-token-1',
        ATLAS_SERVE_PORT: '3000',
        ATLAS_THREAD_ID: 'brn_cloud',
        ATLAS_CLOUD_URL: 'https://api.example.com',
        ATLAS_WORKSPACE_DIR: '/workspace',
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
    })
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
      readStamps: async () => ({ install: STAMP, acceptable: [STAMP] }),
    })

    expect(sandbox.written).toEqual([
      { path: SERVE_TOKEN_PATH, content: 'serve-token-1', mode: 0o600 },
    ])
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
      readStamps: async () => ({ install: STAMP, acceptable: [STAMP] }),
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

  it('recreates a live sandbox whose baked serve is not one this build trusts', async () => {
    const stale = fakeSandbox({ installedStamp: 'source:older-sha' })
    const fresh = fakeSandbox({ installedStamp: 'source:this-build' })
    let getOrCreateParams: Record<string, unknown> | undefined
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      image: 'atlas-sandbox:1.10.0',
      serveSources: ['source:this-build'],
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
      readStamps: async () => ({ install: STAMP, acceptable: [STAMP] }),
    })

    expect(stale.deleted).toBe(true)
    expect(getOrCreateParams?.image).toBe('atlas-sandbox:1.10.0')
  })

  it('resumes a live sandbox whose baked serve this build already trusts, without destroying it', async () => {
    const current = fakeSandbox({ installedStamp: 'source:this-build' })
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      image: 'atlas-sandbox:1.10.0',
      serveSources: ['source:this-build'],
      sdk: { get: async () => current, getOrCreate: async () => current },
    })

    await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
      readStamps: async () => ({ install: STAMP, acceptable: [STAMP] }),
    })

    expect(current.deleted).toBe(false)
  })

  it('never tears a sandbox down on an unreadable stamp — drift has to be proven', async () => {
    const unprobed = fakeSandbox({ stampReadFails: true })
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      image: 'atlas-sandbox:1.10.0',
      serveSources: ['source:this-build'],
      sdk: { get: async () => unprobed, getOrCreate: async () => unprobed },
    })

    await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
      readStamps: async () => ({ install: STAMP, acceptable: [STAMP] }),
    })

    expect(unprobed.deleted).toBe(false)
  })

  it('resumes a sandbox as-is when the build pins no serve identity, whatever stamp it carries', async () => {
    const existing = fakeSandbox({ installedStamp: 'source:anything' })
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      image: 'atlas-sandbox:latest',
      serveSources: [],
      sdk: {
        get: async () => existing,
        getOrCreate: async () => existing,
      },
    })

    await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
      readStamps: async () => ({ install: STAMP, acceptable: [STAMP] }),
    })

    expect(existing.deleted).toBe(false)
  })

  it('uploads the context archive before booting a sandbox Vercel has never seen', async () => {
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
      readStamps: async () => ({ install: STAMP, acceptable: [STAMP] }),
      putContextOnFreshBoot: async () => {
        calls.push('put-context')
      },
    })

    expect(calls).toEqual(['put-context', 'boot'])
  })

  it('uploads the context archive before re-booting a drift-replaced sandbox', async () => {
    const stale = fakeSandbox({ installedStamp: 'source:older-sha' })
    const calls: string[] = []
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      image: 'atlas-sandbox:1.10.0',
      serveSources: ['source:this-build'],
      sdk: {
        get: async () => stale,
        getOrCreate: async () => {
          calls.push('boot')
          return fakeSandbox({ installedStamp: 'source:this-build' })
        },
      },
    })

    await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
      readStamps: async () => ({ install: STAMP, acceptable: [STAMP] }),
      putContextOnFreshBoot: async () => {
        calls.push('put-context')
      },
    })

    expect(stale.deleted).toBe(true)
    expect(calls).toEqual(['put-context', 'boot'])
  })

  it('never uploads the context archive when the sandbox resumes with it', async () => {
    const current = fakeSandbox({ installedStamp: 'source:this-build' })
    let uploads = 0
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      image: 'atlas-sandbox:1.10.0',
      serveSources: ['source:this-build'],
      sdk: { get: async () => current, getOrCreate: async () => current },
    })

    await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
      readStamps: async () => ({ install: STAMP, acceptable: [STAMP] }),
      putContextOnFreshBoot: async () => {
        uploads += 1
      },
    })

    expect(uploads).toBe(0)
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
      readStamps: async () => ({ install: STAMP, acceptable: [STAMP] }),
      pinnedModel: 'anthropic/claude-opus-4.8',
    })
    await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
      readStamps: async () => ({ install: STAMP, acceptable: [STAMP] }),
    })

    expect(seen[0]?.ATLAS_MODEL).toBe('anthropic/claude-opus-4.8')
    expect(seen[1]?.ATLAS_MODEL).toBeUndefined()
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
})
