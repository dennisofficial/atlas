import {
  BadGatewayException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import { connectionRows, ensureUsers } from '../../../../test/github-seed'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
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
  useTestDatabase()
  const calls: { url: string; request: GithubHttpRequest }[] = []
  let fetchImpl: FetchFn
  let service: GithubService

  const fetchFn: FetchFn = async (url, request) => {
    calls.push({ url, request })
    return fetchImpl(url, request)
  }

  beforeEach(async () => {
    await ensureUsers('user-a', 'user-b')
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
      JSON.stringify({
        client_id: CLIENT_ID,
        scope: 'repo read:org admin:repo_hook admin:ssh_signing_key',
      }),
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
    expect(await connectionRows()).toHaveLength(0)
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
        return jsonResponse({
          access_token: 'gho_raw-token',
          scope: 'repo read:org admin:repo_hook admin:ssh_signing_key',
        })
      }
      return jsonResponse({ login: 'octocat' })
    }

    const result = await service.pollConnect({ userId: USER_A, deviceCode: 'dc-1' })

    expect(result).toEqual({
      status: EGithubPollStatus.Connected,
      login: 'octocat',
      scopes: ['repo', 'read:org', 'admin:repo_hook', 'admin:ssh_signing_key'],
    })
    const verification = calls.find((call) => call.url === 'https://api.github.com/user')
    expect(verification?.request.headers.Authorization).toBe('Bearer gho_raw-token')

    const row = (await connectionRows())[0]
    expect(row?.userId).toBe(USER_A)
    expect(row?.login).toBe('octocat')
    expect(row?.scopes).toBe('repo read:org admin:repo_hook admin:ssh_signing_key')
    expect(row?.sealedToken).not.toContain('gho_raw-token')

    const cipher = new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY }))
    expect(cipher.decrypt(row?.sealedToken ?? '')).toBe('gho_raw-token')
  })

  it('poll re-upserts the row when the same user reconnects', async () => {
    fetchImpl = async (url) => {
      if (url === 'https://github.com/login/oauth/access_token') {
        return jsonResponse({
          access_token: 'gho_raw-token',
          scope: 'repo read:org admin:repo_hook admin:ssh_signing_key',
        })
      }
      return jsonResponse({ login: 'octocat' })
    }

    await service.pollConnect({ userId: USER_A, deviceCode: 'dc-1' })
    await service.pollConnect({ userId: USER_A, deviceCode: 'dc-2' })

    expect(await connectionRows()).toHaveLength(1)
  })

  it('scopes the connection to the owning user', async () => {
    fetchImpl = async (url) => {
      if (url === 'https://github.com/login/oauth/access_token') {
        return jsonResponse({
          access_token: 'gho_raw-token',
          scope: 'repo read:org admin:repo_hook admin:ssh_signing_key',
        })
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
        return jsonResponse({
          access_token: 'gho_raw-token',
          scope: 'repo read:org admin:repo_hook admin:ssh_signing_key',
        })
      }
      return jsonResponse({ login: 'octocat' })
    }
    await service.pollConnect({ userId: USER_A, deviceCode: 'dc-1' })

    await service.disconnect({ userId: USER_A })
    await service.disconnect({ userId: USER_A })

    await expect(service.read({ userId: USER_A })).resolves.toEqual({ connected: false })
  })
})
