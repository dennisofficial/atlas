import { ServiceUnavailableException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnvService } from '../../../_core/config/env/env.service'

const sdk = vi.hoisted(() => ({
  getParams: [] as Record<string, unknown>[],
  stopped: [] as string[],
  ranCommands: [] as Record<string, unknown>[],
  status: 'running',
  getFailure: null as Error | null,
  runCommandFailure: null as Error | null,
  driveDeleted: [] as string[],
  driveListParams: [] as Array<Record<string, unknown> | undefined>,
  driveStore: new Map<string, { name: string; delete: () => Promise<void> }>(),
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
    runCommand: async (params: Record<string, unknown>) => {
      sdk.ranCommands.push(params)
      if (sdk.runCommandFailure !== null) throw sdk.runCommandFailure
      return { exitCode: 0 }
    },
  }
  return {
    APIError,
    Drive: {
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
      get: async (params: Record<string, unknown>) => {
        sdk.getParams.push(params)
        if (sdk.getFailure !== null) throw sdk.getFailure
        return sandbox
      },
    },
  }
})

import { APIError } from '@vercel/sandbox'
import { SANDBOX_SERVE_PORT, VercelSandboxClient } from './vercel-sandbox.client'
import { ESandboxState } from './sandboxes.types'

const CONFIGURED: Record<string, string | number> = {
  VERCEL_TOKEN: 'vercel-token',
  VERCEL_TEAM_ID: 'team_1',
  VERCEL_PROJECT_ID: 'prj_1',
}

const envWith = (values: Record<string, string | number | undefined>): EnvService =>
  ({ get: (key: string) => values[key] }) as unknown as EnvService

describe('VercelSandboxClient', () => {
  beforeEach(() => {
    sdk.getParams.length = 0
    sdk.stopped.length = 0
    sdk.ranCommands.length = 0
    sdk.driveDeleted.length = 0
    sdk.driveListParams.length = 0
    sdk.driveStore.clear()
    sdk.status = 'running'
    sdk.getFailure = null
    sdk.runCommandFailure = null
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads a stopped sandbox as parked, a pending one as resuming, and a gone one as parked', async () => {
    const client = new VercelSandboxClient(envWith(CONFIGURED))
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

  it('answers the routed url when one is up', async () => {
    const client = new VercelSandboxClient(envWith(CONFIGURED))

    const observed = await client.inspect({ name: 'atlas-thread-abc' })

    expect(observed).toEqual({
      state: ESandboxState.Running,
      url: `https://atlas-${SANDBOX_SERVE_PORT}.vercel.run`,
    })
  })

  it('stops through the SDK, tolerating a sandbox Vercel no longer has', async () => {
    const client = new VercelSandboxClient(envWith(CONFIGURED))
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

  it('answers 503 when the deployment is unconfigured', async () => {
    const unconfigured = new VercelSandboxClient(envWith({ VERCEL_TOKEN: 'vercel-token' }))
    await expect(unconfigured.inspect({ name: 'atlas-thread-abc' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
    await expect(unconfigured.inspect({ name: 'atlas-thread-abc' })).rejects.toThrow(
      'Atlas Cloud sandboxes are not configured on this deployment',
    )
  })

  it('deletes a drive by name through the SDK, tolerating one already gone', async () => {
    const client = new VercelSandboxClient(envWith(CONFIGURED))
    sdk.driveStore.set('atlas-repo-341', {
      name: 'atlas-repo-341',
      delete: async () => {
        sdk.driveDeleted.push('atlas-repo-341')
      },
    })

    await client.deleteDrive({ name: 'atlas-repo-341' })

    expect(sdk.driveListParams[0]).toMatchObject({
      namePrefix: 'atlas-repo-341',
      sortBy: 'name',
    })
    expect(sdk.driveDeleted).toEqual(['atlas-repo-341'])
  })

  it('curls the sandbox-local park endpoint with the reason and a hard timeout', async () => {
    const client = new VercelSandboxClient(envWith(CONFIGURED))

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
    const client = new VercelSandboxClient(envWith(CONFIGURED))

    await expect(
      client.notifyParked({ name: 'atlas-thread-gone', reason: 'the sandbox was stopped' }),
    ).rejects.toThrow()
  })

  it('propagates a failure when the in-sandbox curl itself fails', async () => {
    sdk.runCommandFailure = new Error('command timed out')
    const client = new VercelSandboxClient(envWith(CONFIGURED))

    await expect(
      client.notifyParked({ name: 'atlas-thread-abc', reason: 'the sandbox was stopped' }),
    ).rejects.toThrow('command timed out')
  })
})
