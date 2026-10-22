import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import { hoisted } from '@dltech/bun-test-shims'
import type { SandboxCredentials } from '../../../_core/ports/sandbox-credentials'

const sdk = hoisted(() => ({
  getParams: [] as Record<string, unknown>[],
  stopped: [] as string[],
  updates: [] as Record<string, unknown>[],
  routes: [{ port: 3000 }] as { port: number }[],
  ranCommands: [] as Record<string, unknown>[],
  status: 'running',
  getFailure: null as Error | null,
  runCommandFailure: null as Error | null,
}))

mock.module('@vercel/sandbox', () => {
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
    get routes() {
      return sdk.routes
    },
    domain: (port: number) => `https://atlas-${port}.vercel.run`,
    update: async (params: Record<string, unknown>) => {
      sdk.updates.push(params)
    },
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
import { SANDBOX_MAX_PORTS } from '@dltech/atlas-wire'
import { SANDBOX_SERVE_PORT, VercelSandboxClient } from './vercel-sandbox.client'
import { ESandboxState } from './sandboxes.types'

const THREAD = 'thr-1'

const credentialsPort = (): { port: SandboxCredentials; forThread: ReturnType<typeof vi.fn> } => {
  const forThread = vi.fn(async () => ({
    token: 'ws-token',
    teamId: 'team_1',
    projectId: 'prj_1',
    workspaceOwned: true,
  }))
  return { port: { forThread } as unknown as SandboxCredentials, forThread }
}

const clientWith = (): VercelSandboxClient => new VercelSandboxClient(credentialsPort().port)

describe('VercelSandboxClient', () => {
  beforeEach(() => {
    sdk.getParams.length = 0
    sdk.stopped.length = 0
    sdk.updates.length = 0
    sdk.routes = [{ port: 3000 }]
    sdk.ranCommands.length = 0
    sdk.status = 'running'
    sdk.getFailure = null
    sdk.runCommandFailure = null
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads a stopped sandbox as parked, a pending one as resuming, and a gone one as parked', async () => {
    const client = clientWith()
    sdk.status = 'stopped'
    expect((await client.inspect({ threadId: THREAD, name: 'atlas-thread-abc' })).state).toBe(ESandboxState.Parked)

    sdk.status = 'pending'
    expect((await client.inspect({ threadId: THREAD, name: 'atlas-thread-abc' })).state).toBe(ESandboxState.Resuming)

    sdk.status = 'running'
    sdk.getFailure = new APIError({ status: 404 } as Response)
    await expect(client.inspect({ threadId: THREAD, name: 'atlas-thread-gone' })).resolves.toEqual({
      state: ESandboxState.Parked,
    })
  })

  it('answers the routed url when one is up', async () => {
    const client = clientWith()

    const observed = await client.inspect({ threadId: THREAD, name: 'atlas-thread-abc' })

    expect(observed).toEqual({
      state: ESandboxState.Running,
      url: `https://atlas-${SANDBOX_SERVE_PORT}.vercel.run`,
    })
  })

  it('stops through the SDK, tolerating a sandbox Vercel no longer has', async () => {
    const client = clientWith()
    await client.stop({ threadId: THREAD, name: 'atlas-thread-abc' })
    expect(sdk.stopped).toHaveLength(1)

    sdk.getFailure = new APIError({ status: 404 } as Response)
    await expect(client.stop({ threadId: THREAD, name: 'atlas-thread-gone' })).resolves.toBeUndefined()

    sdk.getFailure = new APIError(
      { status: 410 } as Response,
      { json: { error: { code: 'snapshot_not_found' } } },
    )
    await expect(client.stop({ threadId: THREAD, name: 'atlas-thread-gone' })).resolves.toBeUndefined()
  })

  it('resolves credentials per thread and hands them to the SDK', async () => {
    const { port, forThread } = credentialsPort()

    await new VercelSandboxClient(port).inspect({ threadId: THREAD, name: 'atlas-thread-abc' })

    expect(forThread).toHaveBeenCalledWith({ threadId: THREAD })
    expect(sdk.getParams[0]).toMatchObject({ token: 'ws-token', teamId: 'team_1', projectId: 'prj_1' })
  })

  it('exposes a new port alongside the routed ones and answers its domain', async () => {
    const url = await clientWith().exposePort({ threadId: THREAD, name: 'atlas-thread-abc', port: 5173 })

    expect(url).toBe('https://atlas-5173.vercel.run')
    expect(sdk.updates).toEqual([{ ports: [3000, 5173] }])
  })

  it('does not update a port that is already routed', async () => {
    const url = await clientWith().exposePort({ threadId: THREAD, name: 'atlas-thread-abc', port: 3000 })

    expect(url).toBe('https://atlas-3000.vercel.run')
    expect(sdk.updates).toHaveLength(0)
  })

  it('refuses a new port once the sandbox is at the port limit', async () => {
    sdk.routes = Array.from({ length: SANDBOX_MAX_PORTS }, (_, index) => ({ port: 3000 + index }))

    await expect(
      clientWith().exposePort({ threadId: THREAD, name: 'atlas-thread-abc', port: 9999 }),
    ).rejects.toThrow(/at most/)
    expect(sdk.updates).toHaveLength(0)
  })

  it('stops a session without resuming the sandbox, refusing a session that is not live', async () => {
    const client = clientWith()
    await client.stopSession({ threadId: THREAD, name: 'atlas-thread-abc', sessionId: 'ses_live' })
    expect(sdk.stopped).toHaveLength(1)
    expect(sdk.getParams[0]).toMatchObject({ resume: false })

    await expect(
      client.stopSession({ threadId: THREAD, name: 'atlas-thread-abc', sessionId: 'ses_other' }),
    ).rejects.toThrow(/refusing to stop/)
    expect(sdk.stopped).toHaveLength(1)

    sdk.getFailure = new APIError({ status: 404 } as Response)
    await expect(
      client.stopSession({ threadId: THREAD, name: 'atlas-thread-gone' }),
    ).resolves.toBeUndefined()
  })

  it('curls the sandbox-local park endpoint with the reason and a hard timeout', async () => {
    const client = clientWith()

    await client.notifyParked({
      threadId: THREAD,
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
    const client = clientWith()

    await expect(
      client.notifyParked({ threadId: THREAD, name: 'atlas-thread-gone', reason: 'the sandbox was stopped' }),
    ).rejects.toThrow()
  })

  it('propagates a failure when the in-sandbox curl itself fails', async () => {
    sdk.runCommandFailure = new Error('command timed out')
    const client = clientWith()

    await expect(
      client.notifyParked({ threadId: THREAD, name: 'atlas-thread-abc', reason: 'the sandbox was stopped' }),
    ).rejects.toThrow('command timed out')
  })
})
