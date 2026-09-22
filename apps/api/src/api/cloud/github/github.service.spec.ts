import {
  BadGatewayException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import type { PrismaClient } from '../../../generated/prisma/client'
import type {
  FetchFn,
  GithubHttpRequest,
  GithubHttpResponse,
} from './github-device-client'
import { GithubDeviceClient } from './github-device-client'
import { GithubService } from './github.service'
import { EGithubPollStatus } from './github.types'

const HEX_KEY =
  'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

interface GithubConnectionRow {
  id: string
  login: string
  scopes: string
  sealedToken: string
  createdAt: Date
  updatedAt: Date
  userId: string
}

const fake = vi.hoisted(() => {
  const connections: GithubConnectionRow[] = []

  const db = {
    githubConnection: {
      findUnique: async (args: { where: { userId: string } }) =>
        connections.find((row) => row.userId === args.where.userId) ?? null,
      upsert: async (args: {
        where: { userId: string }
        create: Omit<GithubConnectionRow, 'createdAt' | 'updatedAt'>
        update: { login: string; scopes: string; sealedToken: string }
      }) => {
        const existing = connections.find((row) => row.userId === args.where.userId)
        if (existing) {
          Object.assign(existing, args.update, { updatedAt: new Date() })
          return existing
        }
        const row = { ...args.create, createdAt: new Date(), updatedAt: new Date() }
        connections.push(row)
        return row
      },
      deleteMany: async (args: { where: { userId: string } }) => {
        const kept = connections.filter((row) => row.userId !== args.where.userId)
        const count = connections.length - kept.length
        connections.splice(0, connections.length, ...kept)
        return { count }
      },
    },
  }

  return { db, connections }
})

vi.mock('../../../db', () => ({ db: fake.db as unknown as PrismaClient }))

const USER_A = 'user-a'
const USER_B = 'user-b'
const CLIENT_ID = 'gh-client-id'

function jsonResponse(body: unknown, status = 200): GithubHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }
}

describe('GithubService', () => {
  const calls: { url: string; request: GithubHttpRequest }[] = []
  let fetchImpl: FetchFn
  let service: GithubService

  const fetchFn: FetchFn = async (url, request) => {
    calls.push({ url, request })
    return fetchImpl(url, request)
  }

  beforeEach(() => {
    fake.connections.length = 0
    calls.length = 0
    fetchImpl = async () => {
      throw new Error('unexpected fetch')
    }
    service = new GithubService(
      new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY })),
      new EnvService({ GITHUB_CLIENT_ID: CLIENT_ID }),
      new GithubDeviceClient({ fetchFn }),
    )
  })

  it('begin maps the snake_case device response to camelCase milliseconds', async () => {
    fetchImpl = async () =>
      jsonResponse({
        device_code: 'dc-1',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      })

    const codes = await service.beginConnect()

    expect(codes).toEqual({
      deviceCode: 'dc-1',
      userCode: 'ABCD-1234',
      verificationUrl: 'https://github.com/login/device',
      expiresInMs: 900_000,
      intervalMs: 5_000,
    })
    expect(calls[0]?.url).toBe('https://github.com/login/device/code')
    expect(calls[0]?.request.body).toBe(
      JSON.stringify({ client_id: CLIENT_ID, scope: 'repo workflow read:org' }),
    )
  })

  it('begin surfaces github error descriptions on non-200 responses', async () => {
    fetchImpl = async () =>
      jsonResponse({ error: 'unauthorized', error_description: 'bad client id' }, 401)

    await expect(service.beginConnect()).rejects.toBeInstanceOf(BadGatewayException)
    await expect(service.beginConnect()).rejects.toThrow('bad client id')
  })

  it('begin answers 503 when github connect is not configured', async () => {
    service = new GithubService(
      new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY })),
      new EnvService({}),
      new GithubDeviceClient({ fetchFn }),
    )

    await expect(service.beginConnect()).rejects.toBeInstanceOf(ServiceUnavailableException)
    await expect(service.beginConnect()).rejects.toThrow('github connect is not configured')
  })

  it.each([
    ['authorization_pending', EGithubPollStatus.Pending],
    ['slow_down', EGithubPollStatus.SlowDown],
    ['access_denied', EGithubPollStatus.Denied],
    ['expired_token', EGithubPollStatus.Expired],
  ])('poll maps the %s error to %s', async (error, status) => {
    fetchImpl = async () => jsonResponse({ error })

    await expect(
      service.pollConnect({ userId: USER_A, deviceCode: 'dc-1' }),
    ).resolves.toEqual({ status })
    expect(fake.connections).toHaveLength(0)
  })

  it('poll answers BadGateway on an unrecognized error', async () => {
    fetchImpl = async () =>
      jsonResponse({ error: 'device_flow_disabled', error_description: 'flow is disabled' })

    await expect(
      service.pollConnect({ userId: USER_A, deviceCode: 'dc-1' }),
    ).rejects.toBeInstanceOf(BadGatewayException)
  })

  it('poll verifies the granted token and stores it sealed', async () => {
    fetchImpl = async (url) => {
      if (url === 'https://github.com/login/oauth/access_token') {
        return jsonResponse({ access_token: 'gho_raw-token', scope: 'repo workflow read:org' })
      }
      return jsonResponse({ login: 'octocat' })
    }

    const result = await service.pollConnect({ userId: USER_A, deviceCode: 'dc-1' })

    expect(result).toEqual({
      status: EGithubPollStatus.Connected,
      login: 'octocat',
      scopes: ['repo', 'workflow', 'read:org'],
    })
    const verification = calls.find((call) => call.url === 'https://api.github.com/user')
    expect(verification?.request.headers.Authorization).toBe('Bearer gho_raw-token')

    const row = fake.connections[0]
    expect(row?.userId).toBe(USER_A)
    expect(row?.login).toBe('octocat')
    expect(row?.scopes).toBe('repo workflow read:org')
    expect(row?.sealedToken).not.toContain('gho_raw-token')

    const cipher = new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY }))
    expect(cipher.decrypt(row?.sealedToken ?? '')).toBe('gho_raw-token')
  })

  it('poll re-upserts the row when the same user reconnects', async () => {
    fetchImpl = async (url) => {
      if (url === 'https://github.com/login/oauth/access_token') {
        return jsonResponse({ access_token: 'gho_raw-token', scope: 'repo' })
      }
      return jsonResponse({ login: 'octocat' })
    }

    await service.pollConnect({ userId: USER_A, deviceCode: 'dc-1' })
    await service.pollConnect({ userId: USER_A, deviceCode: 'dc-2' })

    expect(fake.connections).toHaveLength(1)
  })

  it('scopes the connection to the owning user', async () => {
    fetchImpl = async (url) => {
      if (url === 'https://github.com/login/oauth/access_token') {
        return jsonResponse({ access_token: 'gho_raw-token', scope: 'repo' })
      }
      return jsonResponse({ login: 'octocat' })
    }
    await service.pollConnect({ userId: USER_A, deviceCode: 'dc-1' })

    await expect(service.read({ userId: USER_B })).resolves.toEqual({ connected: false })
    await expect(service.readToken({ userId: USER_B })).rejects.toBeInstanceOf(NotFoundException)

    const own = await service.read({ userId: USER_A })
    expect(own.connected).toBe(true)
  })

  it('readToken answers 404 when nothing is connected', async () => {
    await expect(service.readToken({ userId: USER_A })).rejects.toBeInstanceOf(NotFoundException)
  })

  it('disconnect is idempotent', async () => {
    fetchImpl = async (url) => {
      if (url === 'https://github.com/login/oauth/access_token') {
        return jsonResponse({ access_token: 'gho_raw-token', scope: 'repo' })
      }
      return jsonResponse({ login: 'octocat' })
    }
    await service.pollConnect({ userId: USER_A, deviceCode: 'dc-1' })

    await service.disconnect({ userId: USER_A })
    await service.disconnect({ userId: USER_A })

    await expect(service.read({ userId: USER_A })).resolves.toEqual({ connected: false })
  })
})
