import { beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import { hoisted } from '@dltech/bun-test-shims'
import type { SandboxCredentials } from '../../../_core/ports/sandbox-credentials'

const sdk = hoisted(() => ({
  getParams: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  status: 'running',
  configuredVcpus: 2 as number | undefined,
  sessionVcpus: 2,
  getFailure: null as Error | null,
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
    get vcpus() {
      return sdk.configuredVcpus
    },
    get memory() {
      return sdk.configuredVcpus === undefined ? undefined : sdk.configuredVcpus * 2048
    },
    currentSession: () => ({
      sessionId: 'ses_live',
      vcpus: sdk.sessionVcpus,
      memory: sdk.sessionVcpus * 2048,
    }),
    update: async (params: Record<string, unknown>) => {
      sdk.updates.push(params)
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
import { SandboxMissingError, VercelSandboxClient } from './vercel-sandbox.client'

const THREAD = 'thr-1'
const NAME = 'atlas-thread-abc'

const clientWith = (): VercelSandboxClient => {
  const forThread = vi.fn(async () => ({
    token: 'ws-token',
    teamId: 'team_1',
    projectId: 'prj_1',
    ownerCredential: true,
  }))
  return new VercelSandboxClient({ forThread } as unknown as SandboxCredentials)
}

describe('VercelSandboxClient resources', () => {
  beforeEach(() => {
    sdk.getParams.length = 0
    sdk.updates.length = 0
    sdk.status = 'running'
    sdk.configuredVcpus = 2
    sdk.sessionVcpus = 2
    sdk.getFailure = null
  })

  it('reads the running session size and flags a configured size it has not reached', async () => {
    const client = clientWith()

    expect(await client.readResources({ threadId: THREAD, name: NAME })).toEqual({
      vcpus: 2,
      memoryMb: 4096,
    })

    sdk.configuredVcpus = 4
    expect(await client.readResources({ threadId: THREAD, name: NAME })).toEqual({
      vcpus: 2,
      memoryMb: 4096,
      pendingVcpus: 4,
    })
    expect(sdk.getParams.at(-1)).toMatchObject({ resume: false })
  })

  it('reads the configured size of a parked sandbox without resuming it', async () => {
    sdk.status = 'stopped'
    sdk.configuredVcpus = 4

    expect(await clientWith().readResources({ threadId: THREAD, name: NAME })).toEqual({
      vcpus: 4,
      memoryMb: 8192,
    })
    expect(sdk.getParams.at(-1)).toMatchObject({ resume: false })
  })

  it('stores a new size on the sandbox through update, never resuming it', async () => {
    await clientWith().updateResources({ threadId: THREAD, name: NAME, vcpus: 8 })

    expect(sdk.updates).toEqual([{ resources: { vcpus: 8 } }])
    expect(sdk.getParams.at(-1)).toMatchObject({ resume: false })
  })

  it('answers a missing sandbox as SandboxMissingError', async () => {
    sdk.getFailure = new APIError({ status: 404 } as Response)
    const client = clientWith()

    await expect(
      client.updateResources({ threadId: THREAD, name: NAME, vcpus: 4 }),
    ).rejects.toBeInstanceOf(SandboxMissingError)
    await expect(client.readResources({ threadId: THREAD, name: NAME })).rejects.toBeInstanceOf(
      SandboxMissingError,
    )
  })
})
