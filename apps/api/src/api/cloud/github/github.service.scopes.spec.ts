import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { connectionRows, ensureUsers, seedConnection } from '../../../../test/github-seed'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import type { FetchFn, GithubHttpResponse } from './github-device-client'
import { GithubDeviceClient } from './github-device-client'
import { GithubService } from './github.service'
import { EGithubPollStatus } from './github.types'

const HEX_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

const USER_A = 'user-a'

function jsonResponse(body: unknown, status = 200): GithubHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }
}

describe('GithubService scopes', () => {
  useTestDatabase()
  const calls: string[] = []
  let fetchImpl: FetchFn
  let service: GithubService

  const fetchFn: FetchFn = async (url, request) => {
    calls.push(url)
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
      new EnvService({ GITHUB_CLIENT_ID: 'gh-client-id' }),
      new GithubDeviceClient({ fetchFn }),
    )
  })

  it('poll refuses a grant that is missing scopes and stores nothing', async () => {
    fetchImpl = async () => jsonResponse({ access_token: 'ghu_scoped-down', scope: '' })

    const result = await service.pollConnect({ userId: USER_A, deviceCode: 'dc-1' })

    expect(result).toEqual({
      status: EGithubPollStatus.MissingScopes,
      missing: ['repo', 'read:org', 'admin:repo_hook', 'admin:ssh_signing_key'],
    })
    expect(await connectionRows()).toHaveLength(0)
    expect(calls.includes('https://api.github.com/user')).toBe(false)
  })

  it('poll reports only the scopes that are actually missing', async () => {
    fetchImpl = async () => jsonResponse({ access_token: 'gho_partial', scope: 'repo read:org' })

    const result = await service.pollConnect({ userId: USER_A, deviceCode: 'dc-1' })

    expect(result).toEqual({
      status: EGithubPollStatus.MissingScopes,
      missing: ['admin:repo_hook', 'admin:ssh_signing_key'],
    })
    expect(await connectionRows()).toHaveLength(0)
  })

  it('poll connects a grant carrying the signing scope', async () => {
    const granted = 'repo read:org admin:repo_hook admin:ssh_signing_key'
    fetchImpl = async (url) => {
      if (url === 'https://github.com/login/oauth/access_token') {
        return jsonResponse({ access_token: 'gho_signing', scope: granted })
      }
      return jsonResponse({ login: 'octocat' })
    }

    const result = await service.pollConnect({ userId: USER_A, deviceCode: 'dc-1' })

    expect(result).toEqual({
      status: EGithubPollStatus.Connected,
      login: 'octocat',
      scopes: ['repo', 'read:org', 'admin:repo_hook', 'admin:ssh_signing_key'],
    })
    expect((await connectionRows())[0]?.scopes).toBe(granted)
  })

  it('poll refuses a grant holding only write:ssh_signing_key', async () => {
    fetchImpl = async () =>
      jsonResponse({
        access_token: 'gho_write',
        scope: 'repo read:org admin:repo_hook write:ssh_signing_key',
      })

    const result = await service.pollConnect({ userId: USER_A, deviceCode: 'dc-1' })

    expect(result).toEqual({
      status: EGithubPollStatus.MissingScopes,
      missing: ['admin:ssh_signing_key'],
    })
  })

  it('a stored connection with the old scope string still serves readToken', async () => {
    const cipher = new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY }))
    await seedConnection({
      id: 'gh_old',
      login: 'octocat',
      scopes: 'repo read:org admin:repo_hook',
      sealedToken: cipher.encrypt('gho_old-token'),
      userId: USER_A,
    })

    await expect(service.readToken({ userId: USER_A })).resolves.toEqual({ token: 'gho_old-token' })
    await expect(service.findCredentials({ userId: USER_A })).resolves.toEqual({
      token: 'gho_old-token',
      scopes: 'repo read:org admin:repo_hook',
    })
  })

  it('poll accepts the comma-separated scope string github actually returns', async () => {
    fetchImpl = async (url) => {
      if (url === 'https://github.com/login/oauth/access_token') {
        return jsonResponse({
          access_token: 'gho_raw-token',
          scope: 'admin:repo_hook,admin:ssh_signing_key,read:org,repo',
        })
      }
      return jsonResponse({ login: 'octocat' })
    }

    const result = await service.pollConnect({ userId: USER_A, deviceCode: 'dc-1' })

    expect(result).toEqual({
      status: EGithubPollStatus.Connected,
      login: 'octocat',
      scopes: ['admin:repo_hook', 'admin:ssh_signing_key', 'read:org', 'repo'],
    })
    expect((await connectionRows())[0]?.scopes).toBe(
      'admin:repo_hook,admin:ssh_signing_key,read:org,repo',
    )
  })
})
