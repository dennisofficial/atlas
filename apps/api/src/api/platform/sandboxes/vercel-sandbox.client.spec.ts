import { BadGatewayException, Logger, ServiceUnavailableException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnvService } from '../../../_core/config/env/env.service'
import type { ServeBinaryService } from './serve-binary'

const sdk = vi.hoisted(() => ({
  createParams: [] as Record<string, unknown>[],
  getParams: [] as Record<string, unknown>[],
  stopped: [] as string[],
  deleted: [] as string[],
  routedPorts: [3000],
  ranCommands: [] as Record<string, unknown>[],
  status: 'running',
  getFailure: null as Error | null,
  createFailure: null as Error | null,
  runCommandFailure: null as Error | null,
  sandboxRef: null as unknown,
  driveGetOrCreate: [] as Record<string, unknown>[],
  driveDeleted: [] as string[],
  driveListParams: [] as Array<Record<string, unknown> | undefined>,
  lastDrive: null as unknown,
  driveStore: new Map<string, { name: string }>(),
  initializedDrives: new Set<string>(),
  refuseUninitializedSnapshot: false,
  failCreateOnAttempt: 0,
  resumesInsteadOfCreating: false,
}))

const launch = vi.hoisted(() => ({
  launched: 0,
  tokens: [] as (string | undefined)[],
  failLaunch: false,
  failWithStaleToken: false,
  gate: null as Promise<void> | null,
  readStamp: undefined as (() => Promise<string>) | undefined,
}))

vi.mock('@vercel/sandbox', () => {
  class APIError<ErrorData = unknown> extends Error {
    json: ErrorData | undefined
    constructor(
      readonly response: Response,
      options?: { json?: ErrorData },
    ) {
      super('vercel api error')
      this.json = options?.json
    }
  }
  const sandbox = {
    name: 'atlas-thread-abc',
    get status() {
      return sdk.status
    },
    currentSession: () => ({ sessionId: 'ses_live' }),
    domain: (port: number) => `https://atlas-${port}.vercel.run`,
    get routes() {
      return sdk.routedPorts.map((port) => ({
        port,
        subdomain: `atlas-${port}`,
        url: `https://atlas-${port}.vercel.run`,
      }))
    },
    stop: async () => {
      sdk.stopped.push('stopped')
    },
    delete: async () => {
      sdk.deleted.push('deleted')
    },
    runCommand: async (params: Record<string, unknown>) => {
      sdk.ranCommands.push(params)
      if (sdk.runCommandFailure !== null) throw sdk.runCommandFailure
      return { exitCode: 0 }
    },
  }
  sdk.sandboxRef = sandbox
  class FakeDrive {
    constructor(readonly meta: Record<string, unknown>) {}
    get name() {
      return String(this.meta.name)
    }
    snapshot() {
      return { drive: this.meta.name, mode: 'snapshot' }
    }
    async delete() {
      sdk.driveDeleted.push(this.name)
      sdk.driveStore.delete(this.name)
    }
  }
  return {
    APIError,
    Drive: {
      getOrCreate: async (params: Record<string, unknown>) => {
        sdk.driveGetOrCreate.push(params)
        const drive = new FakeDrive(params)
        sdk.driveStore.set(drive.name, drive)
        sdk.lastDrive = drive
        return drive
      },
      list: async (params?: Record<string, unknown>) => {
        sdk.driveListParams.push(params)
        if (params?.namePrefix !== undefined && params?.sortBy !== 'name') {
          throw new APIError(new Response(null, { status: 400 }), {
            json: {
              error: {
                code: 'bad_request',
                message: 'Invalid request: `namePrefix` is only valid when `sortBy` is `name`',
              },
            },
          })
        }
        const prefix = String(params?.namePrefix ?? '')
        const matched = [...sdk.driveStore.values()].filter((drive) =>
          drive.name.startsWith(prefix),
        )
        return {
          async *[Symbol.asyncIterator]() {
            for (const drive of matched) yield drive
          },
        }
      },
    },
    Sandbox: {
      getOrCreate: async (params: Record<string, unknown>) => {
        sdk.createParams.push(params)
        if (sdk.failCreateOnAttempt === sdk.createParams.length) {
          sdk.failCreateOnAttempt = 0
          throw new Error('the sandbox host is out of capacity')
        }
        if (sdk.createFailure !== null) throw sdk.createFailure
        const mounts = params.mounts as Record<string, unknown> | undefined
        const mount = mounts?.[WORKSPACE_PATH] as
          | { name?: string; mode?: string; drive?: string }
          | undefined
        if (mount !== undefined) {
          const driveName = typeof mount.drive === 'string' ? mount.drive : mount.name
          const isSnapshot = mount.mode === 'snapshot'
          if (
            isSnapshot &&
            sdk.refuseUninitializedSnapshot &&
            driveName !== undefined &&
            !sdk.initializedDrives.has(driveName)
          ) {
            throw new APIError(new Response(null, { status: 400 }), {
              json: {
                error: {
                  code: 'bad_request',
                  message: `The drive ${driveName} has not been initialized yet. Please mount as read-write first before mounting as read-only.`,
                },
              },
            })
          }
          if (driveName !== undefined) sdk.initializedDrives.add(driveName)
        }
        if (sdk.resumesInsteadOfCreating) {
          await (params.onResume as ((sandbox: unknown) => Promise<void>) | undefined)?.(sandbox)
        } else {
          await (params.onCreate as (() => Promise<void>) | undefined)?.()
        }
        return sandbox
      },
      get: async (params: Record<string, unknown>) => {
        sdk.getParams.push(params)
        if (sdk.getFailure !== null) throw sdk.getFailure
        return sandbox
      },
    },
  }
})

vi.mock('./serve-launch', async () => {
  const { StaleSandboxTokenError } = await import('@dltech/atlas-wire')
  return {
    StaleSandboxTokenError,
    createServeLauncher: (args: { readStamp: () => Promise<string> }) => {
      launch.readStamp = args.readStamp
      return async (call: { sandbox: unknown; token?: string }) => {
        launch.tokens.push(call.token)
        if (launch.failWithStaleToken) throw new StaleSandboxTokenError()
        if (launch.failLaunch) throw new Error('atlas serve did not answer')
        if (launch.gate !== null) await launch.gate
        launch.launched += 1
      }
    },
    SERVE_BINARY_PATH: '/opt/atlas/atlas-serve',
    SERVE_LOG_PATH: '/opt/atlas/atlas-serve.log',
    SERVE_TOKEN_PATH: '/opt/atlas/atlas-serve.token',
  }
})

import { APIError } from '@vercel/sandbox'
import {
  SANDBOX_REGION,
  SANDBOX_SERVE_PORT,
  SandboxMissingError,
  VercelSandboxClient,
  WORKSPACE_PATH,
} from './vercel-sandbox.client'
import { ESandboxDriveMode, ESandboxFactoryRole, ESandboxState } from './sandboxes.types'

const CONFIGURED: Record<string, string | number> = {
  VERCEL_TOKEN: 'vercel-token',
  VERCEL_TEAM_ID: 'team_1',
  VERCEL_PROJECT_ID: 'prj_1',
  ATLAS_CLOUD_URL: 'https://api.byatlas.io',
  SANDBOX_MAX_SESSION_MINUTES: 240,
  SANDBOX_IMAGE: 'atlas-sandbox:sha-deadbeef',
}

const envWith = (values: Record<string, string | number | undefined>): EnvService =>
  ({ get: (key: string) => values[key] }) as unknown as EnvService

const fakeServeBinary = () => {
  const stamp = vi.fn(async () => 'build-stamp')
  return { stamp, asService: { stamp } as unknown as ServeBinaryService }
}

type CreateHooks = {
  onCreate: (sandbox: unknown) => Promise<void>
  onResume: (sandbox: unknown) => Promise<void>
}

const hooksOf = (params: Record<string, unknown> | undefined): CreateHooks => params as CreateHooks

describe('VercelSandboxClient', () => {
  beforeEach(() => {
    sdk.createParams.length = 0
    sdk.getParams.length = 0
    sdk.stopped.length = 0
    sdk.deleted.length = 0
    sdk.routedPorts = [3000]
    sdk.ranCommands.length = 0
    sdk.driveGetOrCreate.length = 0
    sdk.driveDeleted.length = 0
    sdk.driveListParams.length = 0
    sdk.lastDrive = null
    sdk.driveStore.clear()
    sdk.initializedDrives.clear()
    sdk.refuseUninitializedSnapshot = false
    sdk.failCreateOnAttempt = 0
    sdk.resumesInsteadOfCreating = false
    sdk.status = 'running'
    sdk.getFailure = null
    sdk.createFailure = null
    sdk.runCommandFailure = null
    launch.launched = 0
    launch.tokens.length = 0
    launch.failLaunch = false
    launch.failWithStaleToken = false
    launch.gate = null
    launch.readStamp = undefined
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('snapshots the sandbox filesystem, mounts nothing, and declares the served port', async () => {
    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)
    const placement = await client.getOrCreate({
      name: 'atlas-thread-abc',
      threadId: 'brn_thread_1',
      token: 'session-token',
    })

    expect(sdk.createParams[0]).toMatchObject({
      name: 'atlas-thread-abc',
      ports: [SANDBOX_SERVE_PORT],
      timeout: 240 * 60_000,
      region: SANDBOX_REGION,
      persistent: true,
      token: 'vercel-token',
      teamId: 'team_1',
      projectId: 'prj_1',
    })
    expect(sdk.createParams[0]).not.toHaveProperty('mounts')
    expect(sdk.createParams[0]?.env).toEqual({
      ATLAS_SERVE_TOKEN: 'session-token',
      ATLAS_SERVE_PORT: String(SANDBOX_SERVE_PORT),
      ATLAS_THREAD_ID: 'brn_thread_1',
      ATLAS_CLOUD_URL: 'https://api.byatlas.io',
      ATLAS_WORKSPACE_DIR: WORKSPACE_PATH,
    })
    expect(placement).toEqual({
      sessionId: 'ses_live',
      url: `https://atlas-${SANDBOX_SERVE_PORT}.vercel.run`,
      state: ESandboxState.Running,
      created: true,
    })
    expect(sdk.createParams[0]?.image).toBe('atlas-sandbox:sha-deadbeef')
  })

  it('reports created: false when the SDK resumes an existing sandbox instead of creating one', async () => {
    sdk.resumesInsteadOfCreating = true
    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)

    const placement = await client.getOrCreate({
      name: 'atlas-thread-abc',
      threadId: 'brn_thread_1',
      token: 'tok_resume',
    })

    expect(placement.created).toBe(false)
  })

  it('mounts a drive at the workspace path and pins the model when told to', async () => {
    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)
    await client.getOrCreate({
      name: 'factory-st-fsr-1',
      threadId: 'brn_station_1',
      token: 'session-token',
      drive: { name: 'factory-compai-atlas-341', mode: ESandboxDriveMode.ReadWrite },
      pinnedModel: 'inference/kimi-k3-fast',
      factoryRole: ESandboxFactoryRole.Station,
    })

    expect(sdk.driveGetOrCreate[0]).toMatchObject({
      name: 'factory-compai-atlas-341',
      region: SANDBOX_REGION,
      maxSize: 50 * 1024 ** 3,
      token: 'vercel-token',
      teamId: 'team_1',
      projectId: 'prj_1',
    })
    const mounts = sdk.createParams[0]?.mounts as Record<string, unknown>
    expect(mounts[WORKSPACE_PATH]).toBe(sdk.lastDrive)
    expect((sdk.createParams[0]?.env as Record<string, string>).ATLAS_MODEL).toBe(
      'inference/kimi-k3-fast',
    )
    expect((sdk.createParams[0]?.env as Record<string, string>).ATLAS_FACTORY_ROLE).toBe(
      'station',
    )
  })

  it('emits no factory role for an ordinary sandbox', async () => {
    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)
    await client.getOrCreate({ name: 'atlas-thread-abc', threadId: 'brn_thread_1', token: 't' })

    expect(sdk.createParams[0]?.env).not.toHaveProperty('ATLAS_FACTORY_ROLE')
  })

  it('emits the decisions url only when one is configured for the org', async () => {
    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)
    await client.getOrCreate({
      name: 'atlas-thread-abc',
      threadId: 'brn_thread_1',
      token: 't',
      decisionsUrl: 'https://api.typesafe.ai/v1/systemone',
    })
    expect((sdk.createParams[0]?.env as Record<string, string>).ATLAS_DECISIONS_URL).toBe(
      'https://api.typesafe.ai/v1/systemone',
    )

    await client.getOrCreate({ name: 'atlas-thread-def', threadId: 'brn_thread_2', token: 't' })
    expect(sdk.createParams[1]?.env).not.toHaveProperty('ATLAS_DECISIONS_URL')
  })

  it('mounts a snapshot mode drive as a read-only snapshot', async () => {
    sdk.driveStore.set('factory-compai-atlas-341', { name: 'factory-compai-atlas-341' })
    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)
    await client.getOrCreate({
      name: 'factory-st-fsr-2',
      threadId: 'brn_station_2',
      token: 'session-token',
      drive: { name: 'factory-compai-atlas-341', mode: ESandboxDriveMode.Snapshot },
    })

    const mounts = sdk.createParams[0]?.mounts as Record<string, unknown>
    expect(mounts[WORKSPACE_PATH]).toEqual({
      drive: 'factory-compai-atlas-341',
      mode: 'snapshot',
    })
  })

  it('lists drives with sortBy name so the namePrefix filter is accepted', async () => {
    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)
    await client.ensureDrive({ name: 'factory-compai-atlas-341' })
    await client.deleteDrive({ name: 'factory-compai-atlas-341' })

    expect(sdk.driveListParams[0]).toMatchObject({
      namePrefix: 'factory-compai-atlas-341',
      sortBy: 'name',
    })
    expect(sdk.driveDeleted).toEqual(['factory-compai-atlas-341'])
  })

  it('a snapshot mount refused as uninitialized retries read-write, initializing the drive, and still provisions', async () => {
    sdk.refuseUninitializedSnapshot = true
    sdk.driveStore.set('factory-fwi-24ea3e1d', { name: 'factory-fwi-24ea3e1d' })
    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)
    const placement = await client.getOrCreate({
      name: 'factory-fwi-24ea3e1d',
      threadId: 'brn_orchestrator_1',
      token: 'session-token',
      drive: { name: 'factory-fwi-24ea3e1d', mode: ESandboxDriveMode.Snapshot },
    })

    expect(sdk.createParams.length).toBe(2)
    const first = sdk.createParams[0]?.mounts as Record<string, unknown>
    const second = sdk.createParams[1]?.mounts as Record<string, unknown>
    expect(first[WORKSPACE_PATH]).toEqual({ drive: 'factory-fwi-24ea3e1d', mode: 'snapshot' })
    expect(second[WORKSPACE_PATH]).toBe(sdk.lastDrive)
    expect(sdk.initializedDrives.has('factory-fwi-24ea3e1d')).toBe(true)
    expect(placement.state).toBe(ESandboxState.Running)
  })

  it('a read-write initializing retry that itself fails surfaces as a bad gateway, not a raw provider error', async () => {
    sdk.refuseUninitializedSnapshot = true
    sdk.driveStore.set('factory-fwi-24ea3e1d', { name: 'factory-fwi-24ea3e1d' })
    sdk.failCreateOnAttempt = 2
    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)

    await expect(
      client.getOrCreate({
        name: 'factory-fwi-24ea3e1d',
        threadId: 'brn_orchestrator_1',
        token: 'session-token',
        drive: { name: 'factory-fwi-24ea3e1d', mode: ESandboxDriveMode.Snapshot },
      }),
    ).rejects.toBeInstanceOf(BadGatewayException)
    expect(sdk.createParams.length).toBe(2)
  })

  it('once initialized by a read-write mount, a later snapshot mount succeeds without a retry', async () => {
    sdk.refuseUninitializedSnapshot = true
    sdk.driveStore.set('factory-fwi-24ea3e1d', { name: 'factory-fwi-24ea3e1d' })
    sdk.initializedDrives.add('factory-fwi-24ea3e1d')
    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)
    await client.getOrCreate({
      name: 'factory-fwi-24ea3e1d',
      threadId: 'brn_orchestrator_1',
      token: 'session-token',
      drive: { name: 'factory-fwi-24ea3e1d', mode: ESandboxDriveMode.Snapshot },
    })

    expect(sdk.createParams.length).toBe(1)
    const mounts = sdk.createParams[0]?.mounts as Record<string, unknown>
    expect(mounts[WORKSPACE_PATH]).toEqual({ drive: 'factory-fwi-24ea3e1d', mode: 'snapshot' })
  })

  it('deletes a drive by name through the SDK', async () => {
    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)
    await client.ensureDrive({ name: 'factory-compai-atlas-341' })
    await client.deleteDrive({ name: 'factory-compai-atlas-341' })

    expect(sdk.driveListParams[0]).toMatchObject({ namePrefix: 'factory-compai-atlas-341' })
    expect(sdk.driveDeleted).toEqual(['factory-compai-atlas-341'])
  })

  it('deleting a drive that was never created does not provision one first', async () => {
    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)
    const created = sdk.driveGetOrCreate.length
    await client.deleteDrive({ name: 'factory-never-existed' })

    expect(sdk.driveGetOrCreate.length).toBe(created)
    expect(sdk.driveDeleted).toEqual([])
  })

  it('logs how long the placement and the serve launch took', async () => {
    const logged: string[] = []
    vi.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
      logged.push(String(message))
    })

    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)
    await client.getOrCreate({ name: 'atlas-thread-abc', threadId: 'brn_thread_1', token: 't' })

    expect(
      logged.some(
        (line) =>
          line.includes('atlas-thread-abc') &&
          /get-or-create \d+ms/.test(line) &&
          /serve launch \d+ms/.test(line),
      ),
    ).toBe(true)
  })

  it('hands the session token to the serve launch, on creation and on the resume hook alike', async () => {
    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)
    await client.getOrCreate({
      name: 'atlas-thread-abc',
      threadId: 'brn_thread_1',
      token: 'tok_fresh',
    })
    expect(launch.tokens).toEqual(['tok_fresh'])

    const hooks = hooksOf(sdk.createParams[0])
    await hooks.onResume(sdk.sandboxRef)
    expect(launch.tokens).toEqual(['tok_fresh', 'tok_fresh'])
  })

  it('launches serve on creation and again on the SDK resume hook, reading the stamp lazily', async () => {
    const serveBinary = fakeServeBinary()
    const client = new VercelSandboxClient(envWith(CONFIGURED), serveBinary.asService)
    await client.getOrCreate({ name: 'atlas-thread-abc', threadId: 'brn_thread_1', token: 't' })
    expect(launch.launched).toBe(1)
    expect(serveBinary.stamp).not.toHaveBeenCalled()
    await expect(launch.readStamp?.()).resolves.toBe('build-stamp')
    expect(serveBinary.stamp).toHaveBeenCalledTimes(1)

    const hooks = hooksOf(sdk.createParams[0])
    await hooks.onResume({})
    expect(launch.launched).toBe(2)
  })

  it('propagates a serve that never becomes healthy instead of returning a dead URL', async () => {
    launch.failLaunch = true
    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)
    await expect(
      client.getOrCreate({ name: 'atlas-thread-abc', threadId: 'brn_thread_1', token: 't' }),
    ).rejects.toThrow('atlas serve did not answer')
  })

  it('reads a stopped sandbox as parked, a pending one as resuming, and a gone one as parked', async () => {
    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)
    sdk.status = 'stopped'
    expect((await client.inspect({ name: 'atlas-thread-abc' })).state).toBe(ESandboxState.Parked)

    sdk.status = 'pending'
    expect((await client.inspect({ name: 'atlas-thread-abc' })).state).toBe(ESandboxState.Resuming)

    sdk.status = 'running'
    sdk.getFailure = new APIError({ status: 404 } as Response)
    await expect(client.inspect({ name: 'atlas-thread-gone' })).resolves.toEqual({
      state: ESandboxState.Parked,
    })
  })

  it('stops through the SDK, tolerating a sandbox Vercel no longer has', async () => {
    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)
    await client.stop({ name: 'atlas-thread-abc' })
    expect(sdk.stopped).toHaveLength(1)

    sdk.getFailure = new APIError({ status: 404 } as Response)
    await expect(client.stop({ name: 'atlas-thread-gone' })).resolves.toBeUndefined()

    sdk.getFailure = new APIError(
      { status: 410 } as Response,
      { json: { error: { code: 'snapshot_not_found' } } },
    )
    await expect(client.stop({ name: 'atlas-thread-gone' })).resolves.toBeUndefined()
  })

  it('answers 503 when the deployment is unconfigured, whole or missing only the image', async () => {
    const unconfigured = new VercelSandboxClient(
      envWith({ VERCEL_TOKEN: 'vercel-token' }),
      fakeServeBinary().asService,
    )
    await expect(unconfigured.inspect({ name: 'atlas-thread-abc' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
    await expect(unconfigured.inspect({ name: 'atlas-thread-abc' })).rejects.toThrow(
      'Atlas Cloud sandboxes are not configured on this deployment',
    )

    const { SANDBOX_IMAGE: _omitted, ...withoutImage } = CONFIGURED
    const imageless = new VercelSandboxClient(envWith(withoutImage), fakeServeBinary().asService)
    await expect(imageless.inspect({ name: 'atlas-thread-abc' })).rejects.toThrow(
      'Atlas Cloud sandboxes are not configured on this deployment',
    )
  })

  it('destroys the sandbox and reports it missing when the serve token has gone stale', async () => {
    launch.failWithStaleToken = true
    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)
    await expect(
      client.getOrCreate({ name: 'atlas-thread-abc', threadId: 'brn_thread_1', token: 't' }),
    ).rejects.toBeInstanceOf(SandboxMissingError)
    expect(sdk.deleted).toHaveLength(1)
  })

  it('turns a non-missing Vercel API failure into a legible bad gateway error', async () => {
    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)
    sdk.createFailure = new APIError(
      { status: 500 } as Response,
      { json: { error: { message: 'quota exceeded' } } },
    )

    const failure = client.getOrCreate({
      name: 'atlas-thread-abc',
      threadId: 'brn_thread_1',
      token: 't',
    })
    await expect(failure).rejects.toBeInstanceOf(BadGatewayException)
    await expect(failure).rejects.toThrow('quota exceeded')
  })

  it('curls the sandbox-local park endpoint with the reason and a hard timeout', async () => {
    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)

    await client.notifyParked({
      name: 'atlas-thread-abc',
      reason: 'the sandbox parked after sitting idle',
    })

    expect(sdk.ranCommands).toHaveLength(1)
    const call = sdk.ranCommands[0] as {
      cmd: string
      args: string[]
      env: Record<string, string>
      timeoutMs: number
    }
    expect(call.cmd).toBe('sh')
    expect(call.args[1]).toContain('/opt/atlas/atlas-serve.token')
    expect(call.args[1]).toContain(`http://localhost:${SANDBOX_SERVE_PORT}/v1/park`)
    expect(call.args[1]).toContain('$ATLAS_PARK_REASON')
    expect(call.env).toEqual({
      ATLAS_PARK_REASON: JSON.stringify({ reason: 'the sandbox parked after sitting idle' }),
    })
    expect(call.timeoutMs).toBeLessThanOrEqual(3_000)
  })

  it('propagates a failure notifying a sandbox that has gone missing', async () => {
    sdk.getFailure = new APIError({ status: 404 } as Response)
    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)

    await expect(
      client.notifyParked({ name: 'atlas-thread-gone', reason: 'the sandbox was stopped' }),
    ).rejects.toThrow()
  })

  it('propagates a failure when the in-sandbox curl itself fails', async () => {
    sdk.runCommandFailure = new Error('command timed out')
    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)

    await expect(
      client.notifyParked({ name: 'atlas-thread-abc', reason: 'the sandbox was stopped' }),
    ).rejects.toThrow('command timed out')
  })

  it('joins a launch already in flight for the same sandbox instead of running it twice', async () => {
    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)
    await client.getOrCreate({ name: 'atlas-thread-abc', threadId: 'brn_thread_1', token: 't' })
    expect(launch.launched).toBe(1)

    let releaseLaunch: () => void = () => undefined
    launch.gate = new Promise((resolve) => {
      releaseLaunch = resolve
    })
    const hooks = hooksOf(sdk.createParams[0])
    const first = hooks.onResume(sdk.sandboxRef)
    const second = hooks.onResume(sdk.sandboxRef)
    releaseLaunch()
    await Promise.all([first, second])

    expect(launch.launched).toBe(2)
  })
})
