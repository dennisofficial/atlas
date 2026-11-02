import { createPublicKey, createVerify } from 'node:crypto'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, describe, expect, it } from 'bun:test'
import { db } from '@dltech/atlas-db'
import {
  fakeGithubApp,
  syncServiceWith,
  TEST_APP_PUBLIC_KEY,
  type FakeInstallation,
} from './github-app-sync.fixture'

const PERSONAL: FakeInstallation = {
  id: 145998843,
  login: 'dennisofficial',
  repos: ['DennisOfficial/Atlas'],
}
let github: ReturnType<typeof fakeGithubApp> | undefined

afterEach(() => github?.restore())

describe('GithubAppSyncService', () => {
  useTestDatabase()

  it('inserts a missing installation with all its repos, paging past 100', async () => {
    const many = Array.from({ length: 130 }, (_, index) => `dennisofficial/repo-${index}`)
    github = fakeGithubApp({
      installations: [{ ...PERSONAL, repos: [...many, 'DennisOfficial/Atlas'] }],
    })
    const { service, installations } = syncServiceWith()

    await service.syncFromGithub()

    expect(await installations.heldRepos({ installationId: 145998843n })).toHaveLength(131)
    expect(await installations.coversRepo({ repoFullName: 'dennisofficial/atlas' })).toBe(true)
  })

  it('updates repos, marks suspended and removes an installation GitHub no longer lists', async () => {
    github = fakeGithubApp({
      installations: [PERSONAL, { id: 7, login: 'gone', repos: ['gone/x'] }],
    })
    const { service, installations } = syncServiceWith()
    await service.syncFromGithub()
    expect(await installations.coversRepo({ repoFullName: 'gone/x' })).toBe(true)

    github.state.installations = [{ ...PERSONAL, repos: ['dennisofficial/other'] }]
    await service.syncFromGithub()
    expect(await installations.coversRepo({ repoFullName: 'gone/x' })).toBe(false)
    expect(await installations.coversRepo({ repoFullName: 'dennisofficial/atlas' })).toBe(false)
    expect(await installations.coversRepo({ repoFullName: 'dennisofficial/other' })).toBe(true)

    github.state.installations = [{ ...PERSONAL, repos: ['dennisofficial/other'], suspended: true }]
    await service.syncFromGithub()
    const row = await db.orm.public.GithubAppInstallation.first({
      installationId: 145998843n,
    })
    expect(row?.suspendedAt).not.toBeNull()
    expect(await installations.coversRepo({ repoFullName: 'dennisofficial/other' })).toBe(false)
  })

  it('syncs once for an unknown installation id and debounces repeats', async () => {
    github = fakeGithubApp({ installations: [PERSONAL] })
    const { service } = syncServiceWith()

    await service.syncUnknownInstallation({ installationId: 999 })
    await service.syncUnknownInstallation({ installationId: 999 })

    expect(github.calls.filter((call) => call === 'GET /app/installations')).toHaveLength(1)
  })

  it('does not sync for an installation it already holds', async () => {
    github = fakeGithubApp({ installations: [PERSONAL] })
    const { service } = syncServiceWith()
    await service.syncFromGithub()
    github.calls.length = 0

    await service.syncUnknownInstallation({ installationId: 145998843 })

    expect(github.calls).toEqual([])
  })

  it('throttles the periodic sync to once per window', async () => {
    github = fakeGithubApp({ installations: [PERSONAL] })
    const { service } = syncServiceWith()

    await service.syncIfDue()
    await service.syncIfDue()

    expect(github.calls.filter((call) => call === 'GET /app/installations')).toHaveLength(1)
  })

  it('signs an RS256 JWT with the app id as iss and a 10 minute ceiling', () => {
    const { client } = syncServiceWith()
    const jwt = client.signJwt({ nowSeconds: 1_000_000 })
    const [header, payload, signature] = jwt.split('.') as [string, string, string]

    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    })
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toEqual({
      iat: 999_940,
      exp: 1_000_540,
      iss: '4242',
    })
    const verified = createVerify('RSA-SHA256')
      .update(`${header}.${payload}`)
      .verify(createPublicKey(TEST_APP_PUBLIC_KEY), Buffer.from(signature, 'base64url'))
    expect(verified).toBe(true)
  })
})
