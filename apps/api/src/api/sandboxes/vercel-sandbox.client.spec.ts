import { ServiceUnavailableException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnvService } from '../../_core/config/env/env.service'
import type { ServeBinaryService } from './serve-binary'

const sdk = vi.hoisted(() => ({
  createParams: [] as Record<string, unknown>[],
  getParams: [] as Record<string, unknown>[],
  stopped: [] as string[],
  status: 'running',
}))

const launch = vi.hoisted(() => ({
  launched: 0,
  failLaunch: false,
  readStamp: undefined as (() => Promise<string>) | undefined,
}))

vi.mock('@vercel/sandbox', () => {
  const sandbox = {
    get status() {
      return sdk.status
    },
    currentSession: () => ({ sessionId: 'ses_live' }),
    domain: (port: number) => `https://atlas-${port}.vercel.run`,
    stop: async () => {
      sdk.stopped.push('stopped')
    },
  }
  return {
    Sandbox: {
      getOrCreate: async (params: Record<string, unknown>) => {
        sdk.createParams.push(params)
        return sandbox
      },
      get: async (params: Record<string, unknown>) => {
        sdk.getParams.push(params)
        return sandbox
      },
    },
  }
})

vi.mock('./serve-launch', () => ({
  createServeLauncher: (args: { readStamp: () => Promise<string> }) => {
    launch.readStamp = args.readStamp
    return async () => {
      if (launch.failLaunch) throw new Error('atlas serve did not answer')
      launch.launched += 1
    }
  },
  SERVE_BINARY_PATH: '/vercel/sandbox/atlas-serve',
  SERVE_LOG_PATH: '/vercel/sandbox/atlas-serve.log',
}))

import {
  SANDBOX_REGION,
  SANDBOX_SERVE_PORT,
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
    sdk.status = 'running'
    launch.launched = 0
    launch.failLaunch = false
    launch.readStamp = undefined
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
  })

  it('boots the sandbox from the configured image', async () => {
    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)

    await client.getOrCreate({ name: 'atlas-thread-abc', threadId: 'brn_thread_1', token: 't' })

    expect(sdk.createParams[0]?.image).toBe('atlas-sandbox:sha-deadbeef')
  })

  it('restarts serve on every resume and after the SDK resolves, whatever path resolved it', async () => {
    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)

    await client.getOrCreate({ name: 'atlas-thread-abc', threadId: 'brn_thread_1', token: 't' })
    expect(launch.launched).toBe(1)
    const hooks = hooksOf(sdk.createParams[0])
    await hooks.onResume({})
    expect(launch.launched).toBe(2)

    await client.resume({ name: 'atlas-thread-abc' })
    expect(launch.launched).toBe(3)
    expect(sdk.getParams.at(-1)).toMatchObject({ name: 'atlas-thread-abc', resume: true })
    expect(sdk.getParams.at(-1)).toHaveProperty('onResume')
  })

  it('propagates a serve that never becomes healthy instead of returning a dead URL', async () => {
    launch.failLaunch = true
    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)

    await expect(
      client.getOrCreate({ name: 'atlas-thread-abc', threadId: 'brn_thread_1', token: 't' }),
    ).rejects.toThrow('atlas serve did not answer')
  })

  it('reads the serve stamp lazily through the binary service', async () => {
    const serveBinary = fakeServeBinary()
    const client = new VercelSandboxClient(envWith(CONFIGURED), serveBinary.asService)

    await client.getOrCreate({ name: 'atlas-thread-abc', threadId: 'brn_thread_1', token: 't' })
    expect(serveBinary.stamp).not.toHaveBeenCalled()

    await expect(launch.readStamp?.()).resolves.toBe('build-stamp')
    expect(serveBinary.stamp).toHaveBeenCalledTimes(1)
  })

  it('reads a stopped sandbox as parked and a pending one as resuming', async () => {
    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)

    sdk.status = 'stopped'
    expect((await client.inspect({ name: 'atlas-thread-abc' })).state).toBe(ESandboxState.Parked)

    sdk.status = 'pending'
    expect((await client.inspect({ name: 'atlas-thread-abc' })).state).toBe(ESandboxState.Resuming)
  })

  it('stops through the SDK and resumes on demand', async () => {
    const client = new VercelSandboxClient(envWith(CONFIGURED), fakeServeBinary().asService)

    await client.stop({ name: 'atlas-thread-abc' })
    expect(sdk.stopped).toHaveLength(1)

    await client.resume({ name: 'atlas-thread-abc' })
    expect(sdk.getParams.at(-1)).toMatchObject({ name: 'atlas-thread-abc', resume: true })
  })

  it('answers 503 with a specific reason when the deployment is unconfigured', async () => {
    const client = new VercelSandboxClient(
      envWith({ VERCEL_TOKEN: 'vercel-token' }),
      fakeServeBinary().asService,
    )

    await expect(client.inspect({ name: 'atlas-thread-abc' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
    await expect(client.inspect({ name: 'atlas-thread-abc' })).rejects.toThrow(
      'Atlas Cloud sandboxes are not configured on this deployment',
    )
  })
})
