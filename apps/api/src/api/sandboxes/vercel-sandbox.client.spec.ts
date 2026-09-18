import { BadGatewayException, Logger, ServiceUnavailableException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnvService } from '../../_core/config/env/env.service'
import type { ServeBinaryService } from './serve-binary'

const sdk = vi.hoisted(() => ({
  createParams: [] as Record<string, unknown>[],
  getParams: [] as Record<string, unknown>[],
  stopped: [] as string[],
  deleted: [] as string[],
  status: 'running',
  getFailure: null as Error | null,
  createFailure: null as Error | null,
  sandboxRef: null as unknown,
}))

const launch = vi.hoisted(() => ({
  launched: 0,
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
    stop: async () => {
      sdk.stopped.push('stopped')
    },
    delete: async () => {
      sdk.deleted.push('deleted')
    },
  }
  sdk.sandboxRef = sandbox
  return {
    APIError,
    Sandbox: {
      getOrCreate: async (params: Record<string, unknown>) => {
        sdk.createParams.push(params)
        if (sdk.createFailure !== null) throw sdk.createFailure
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

vi.mock('./serve-launch', () => {
  class StaleSandboxTokenError extends Error {
    constructor() {
      super('the sandbox carries a serve token this deployment no longer recognizes')
      this.name = 'StaleSandboxTokenError'
    }
  }
  return {
    StaleSandboxTokenError,
    createServeLauncher: (args: { readStamp: () => Promise<string> }) => {
      launch.readStamp = args.readStamp
      return async () => {
        if (launch.failWithStaleToken) throw new StaleSandboxTokenError()
        if (launch.failLaunch) throw new Error('atlas serve did not answer')
        if (launch.gate !== null) await launch.gate
        launch.launched += 1
      }
    },
    SERVE_BINARY_PATH: '/vercel/sandbox/atlas-serve',
    SERVE_LOG_PATH: '/vercel/sandbox/atlas-serve.log',
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
import { ESandboxState } from './sandboxes.types'

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
    sdk.status = 'running'
    sdk.getFailure = null
    sdk.createFailure = null
    launch.launched = 0
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
    })
    expect(sdk.createParams[0]?.image).toBe('atlas-sandbox:sha-deadbeef')
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

  it('stops and destroys through the SDK, tolerating a sandbox Vercel no longer has', async () => {
    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)
    await client.stop({ name: 'atlas-thread-abc' })
    expect(sdk.stopped).toHaveLength(1)
    await client.destroy({ name: 'atlas-thread-abc' })
    expect(sdk.deleted).toHaveLength(1)

    sdk.getFailure = new APIError({ status: 404 } as Response)
    await expect(client.stop({ name: 'atlas-thread-gone' })).resolves.toBeUndefined()
    await expect(client.destroy({ name: 'atlas-thread-gone' })).resolves.toBeUndefined()

    sdk.getFailure = new APIError(
      { status: 410 } as Response,
      { json: { error: { code: 'snapshot_not_found' } } },
    )
    await expect(client.destroy({ name: 'atlas-thread-gone' })).resolves.toBeUndefined()
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
