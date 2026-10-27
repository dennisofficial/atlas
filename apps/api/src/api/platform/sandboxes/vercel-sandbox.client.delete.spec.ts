import { BadGatewayException } from '@nestjs/common'
import { beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import { hoisted } from '@dltech/bun-test-shims'
import type { SandboxCredentials } from '../../../_core/ports/sandbox-credentials'

const sdk = hoisted(() => ({
  getParams: [] as Record<string, unknown>[],
  deleteSignals: [] as (AbortSignal | undefined)[],
  getFailure: null as Error | null,
  deleteFailure: null as Error | null,
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
    delete: async (options?: { signal?: AbortSignal }) => {
      sdk.deleteSignals.push(options?.signal)
      if (sdk.deleteFailure !== null) throw sdk.deleteFailure
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
import { VercelSandboxClient } from './vercel-sandbox.client'

const THREAD = 'thr-1'

const clientWith = (): VercelSandboxClient => {
  const forThread = vi.fn(async () => ({
    token: 'ws-token',
    teamId: 'team_1',
    projectId: 'prj_1',
    ownerCredential: true,
  }))
  return new VercelSandboxClient({ forThread } as unknown as SandboxCredentials)
}

describe('VercelSandboxClient.delete', () => {
  beforeEach(() => {
    sdk.getParams.length = 0
    sdk.deleteSignals.length = 0
    sdk.getFailure = null
    sdk.deleteFailure = null
  })

  it('deletes the named sandbox without resuming it, under the thread credentials', async () => {
    await clientWith().delete({ threadId: THREAD, name: 'atlas-thread-abc' })

    expect(sdk.getParams[0]).toMatchObject({
      token: 'ws-token',
      teamId: 'team_1',
      projectId: 'prj_1',
      name: 'atlas-thread-abc',
      resume: false,
    })
    expect(sdk.deleteSignals).toHaveLength(1)
    expect(sdk.deleteSignals[0]).toBeInstanceOf(AbortSignal)
  })

  it('counts a sandbox Vercel no longer has as already gone', async () => {
    const client = clientWith()
    sdk.getFailure = new APIError({ status: 404 } as Response)
    await expect(
      client.delete({ threadId: THREAD, name: 'atlas-thread-gone' }),
    ).resolves.toBeUndefined()

    sdk.getFailure = new APIError({ status: 410 } as Response, {
      json: { error: { code: 'snapshot_not_found' } },
    })
    await expect(
      client.delete({ threadId: THREAD, name: 'atlas-thread-gone' }),
    ).resolves.toBeUndefined()
    expect(sdk.deleteSignals).toHaveLength(0)
  })

  it('counts a sandbox that vanishes between lookup and delete as already gone', async () => {
    sdk.deleteFailure = new APIError({ status: 404 } as Response)

    await expect(
      clientWith().delete({ threadId: THREAD, name: 'atlas-thread-abc' }),
    ).resolves.toBeUndefined()
  })

  it('fails on any other lookup or delete error, so the caller can retry', async () => {
    const client = clientWith()
    sdk.getFailure = new APIError({ status: 500 } as Response)
    await expect(
      client.delete({ threadId: THREAD, name: 'atlas-thread-abc' }),
    ).rejects.toBeInstanceOf(BadGatewayException)

    sdk.getFailure = null
    sdk.deleteFailure = new Error('connection reset')
    await expect(client.delete({ threadId: THREAD, name: 'atlas-thread-abc' })).rejects.toThrow(
      'connection reset',
    )
  })
})
