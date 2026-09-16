import { ServiceUnavailableException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnvService } from '../../_core/config/env/env.service'

const sdk = vi.hoisted(() => ({
  createParams: [] as Record<string, unknown>[],
  getParams: [] as Record<string, unknown>[],
  stopped: [] as string[],
  status: 'running',
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
}

const envWith = (values: Record<string, string | number | undefined>): EnvService =>
  ({ get: (key: string) => values[key] }) as unknown as EnvService

describe('VercelSandboxClient', () => {
  beforeEach(() => {
    sdk.createParams.length = 0
    sdk.getParams.length = 0
    sdk.stopped.length = 0
    sdk.status = 'running'
  })

  it('snapshots the sandbox filesystem, mounts nothing, and declares the served port', async () => {
    const client = new VercelSandboxClient(envWith(CONFIGURED))

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

  it('reads a stopped sandbox as parked and a pending one as resuming', async () => {
    const client = new VercelSandboxClient(envWith(CONFIGURED))

    sdk.status = 'stopped'
    expect((await client.inspect({ name: 'atlas-thread-abc' })).state).toBe(ESandboxState.Parked)

    sdk.status = 'pending'
    expect((await client.inspect({ name: 'atlas-thread-abc' })).state).toBe(ESandboxState.Resuming)
  })

  it('stops through the SDK and resumes on demand', async () => {
    const client = new VercelSandboxClient(envWith(CONFIGURED))

    await client.stop({ name: 'atlas-thread-abc' })
    expect(sdk.stopped).toHaveLength(1)

    await client.resume({ name: 'atlas-thread-abc' })
    expect(sdk.getParams.at(-1)).toMatchObject({ name: 'atlas-thread-abc', resume: true })
  })

  it('answers 503 with a specific reason when the deployment is unconfigured', async () => {
    const client = new VercelSandboxClient(envWith({ VERCEL_TOKEN: 'vercel-token' }))

    await expect(client.inspect({ name: 'atlas-thread-abc' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
    await expect(client.inspect({ name: 'atlas-thread-abc' })).rejects.toThrow(
      'Atlas Cloud sandboxes are not configured on this deployment',
    )
  })
})
