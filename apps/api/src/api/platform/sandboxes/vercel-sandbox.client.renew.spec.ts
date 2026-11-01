import { beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import { hoisted } from '@dltech/bun-test-shims'
import type { SandboxCredentials } from '../../../_core/ports/sandbox-credentials'

const sdk = hoisted(() => ({
  getParams: [] as Record<string, unknown>[],
  extensions: [] as number[],
  sessionId: 'ses_live',
  sessionStatus: 'running',
  expiresAt: 1_000_000 as number | undefined,
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
      return sdk.sessionStatus
    },
    get expiresAt() {
      return sdk.expiresAt === undefined ? undefined : new Date(sdk.expiresAt)
    },
    currentSession: () => ({
      sessionId: sdk.sessionId,
      status: sdk.sessionStatus,
      startedAt: new Date(500_000),
      extendTimeout: async (delta: number) => {
        sdk.extensions.push(delta)
        if (sdk.expiresAt !== undefined) sdk.expiresAt += delta
      },
    }),
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
import { BadGatewayException } from '@nestjs/common'
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
  return new VercelSandboxClient({
    forThread,
  } as unknown as SandboxCredentials)
}

const renew = (args: { sessionId?: string; until: number }) =>
  clientWith().renewDeadline({
    threadId: THREAD,
    name: NAME,
    sessionId: args.sessionId ?? 'ses_live',
    until: args.until,
  })

describe('VercelSandboxClient renewDeadline', () => {
  beforeEach(() => {
    sdk.getParams.length = 0
    sdk.extensions.length = 0
    sdk.sessionId = 'ses_live'
    sdk.sessionStatus = 'running'
    sdk.expiresAt = 1_000_000
    sdk.getFailure = null
  })

  it('extends the live session by the gap to until and answers the observation', async () => {
    const observation = await renew({ until: 1_600_000 })

    expect(sdk.extensions).toEqual([600_000])
    expect(observation).toEqual({
      sessionId: 'ses_live',
      expiresAt: 1_600_000,
      startedAt: 500_000,
      extendedByMs: 600_000,
    })
    expect(sdk.getParams.at(-1)).toMatchObject({ resume: false })
  })

  it('rejects a stale session id without extending', async () => {
    await expect(renew({ sessionId: 'ses_old', until: 1_600_000 })).rejects.toBeInstanceOf(
      BadGatewayException,
    )
    expect(sdk.extensions).toEqual([])
  })

  it('rejects a stopped session without extending', async () => {
    sdk.sessionStatus = 'stopped'

    await expect(renew({ until: 1_600_000 })).rejects.toBeInstanceOf(BadGatewayException)
    expect(sdk.extensions).toEqual([])
  })

  it('does not extend when the deadline is already past until', async () => {
    const observation = await renew({ until: 900_000 })

    expect(sdk.extensions).toEqual([])
    expect(observation.extendedByMs).toBe(0)
    expect(observation.expiresAt).toBe(1_000_000)
  })

  it('answers a missing sandbox as SandboxMissingError', async () => {
    sdk.getFailure = new APIError({ status: 404 } as Response)

    await expect(renew({ until: 1_600_000 })).rejects.toBeInstanceOf(SandboxMissingError)
  })
})
