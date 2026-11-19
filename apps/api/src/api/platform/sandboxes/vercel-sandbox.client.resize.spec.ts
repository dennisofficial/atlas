import { beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import { hoisted } from '@dltech/bun-test-shims'
import type { SandboxCredentials } from '../../../_core/ports/sandbox-credentials'

const sdk = hoisted(() => ({
  getParams: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  stops: [] as string[],
  status: 'running',
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
    name: 'atlas-v2-abc',
    get status() {
      return sdk.status
    },
    update: async (params: Record<string, unknown>) => {
      sdk.updates.push(params)
    },
    stop: async () => {
      sdk.stops.push('stopped')
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

import { NotFoundException } from '@nestjs/common'
import { APIError } from '@vercel/sandbox'
import { VercelSandboxClient } from './vercel-sandbox.client'

const NAME = 'atlas-v2-abc'

const clientWith = (): { client: VercelSandboxClient; forUser: ReturnType<typeof vi.fn> } => {
  const forUser = vi.fn(async () => ({
    token: 'user-token',
    teamId: 'team_1',
    projectId: 'prj_1',
  }))
  return {
    client: new VercelSandboxClient({ forUser } as unknown as SandboxCredentials),
    forUser,
  }
}

describe('VercelSandboxClient resizePod', () => {
  beforeEach(() => {
    sdk.getParams.length = 0
    sdk.updates.length = 0
    sdk.stops.length = 0
    sdk.status = 'running'
    sdk.getFailure = null
  })

  it('stores the new size on the user-credential sandbox, then stops it', async () => {
    const { client, forUser } = clientWith()

    await client.resizePod({ userId: 'user-a', name: NAME, vcpus: 8 })

    expect(forUser).toHaveBeenCalledWith({ userId: 'user-a' })
    expect(sdk.getParams.at(-1)).toMatchObject({ name: NAME, resume: false, token: 'user-token' })
    expect(sdk.updates).toEqual([{ resources: { vcpus: 8 } }])
    expect(sdk.stops).toEqual(['stopped'])
  })

  it('stores the size of an already stopped sandbox and leaves it stopped', async () => {
    sdk.status = 'stopped'
    const { client } = clientWith()

    await client.resizePod({ userId: 'user-a', name: NAME, vcpus: 4 })

    expect(sdk.updates).toEqual([{ resources: { vcpus: 4 } }])
    expect(sdk.stops).toEqual([])
  })

  it('answers a missing sandbox as NotFound', async () => {
    sdk.getFailure = new APIError({ status: 404 } as Response)

    await expect(
      clientWith().client.resizePod({ userId: 'user-a', name: NAME, vcpus: 4 }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})
