import { useTestDatabase } from '@dltech/atlas-db/testing'
import { db } from '@dltech/atlas-db'
import { Logger } from '@nestjs/common'
import { afterEach, describe, expect, it, setSystemTime, spyOn } from 'bun:test'
import { EnvService } from '../../../_core/config/env/env.service'
import { GithubAppClient } from './github-app-client'
import { GithubAppInstallationsService } from './github-app-installations.service'
import { FAKE_TOKEN_LIFETIME_MS, fakeGithubApp, syncServiceWith } from './github-app-sync.fixture'
import { GithubInstallationTokens } from './github-installation-tokens'

const REFRESH_MARGIN_MS = 5 * 60 * 1_000

const seedCoverage = (args: {
  installationId: bigint
  repos: string[]
  suspendedAt?: Date | null
}): Promise<unknown> =>
  db.orm.public.GithubAppInstallation.create({
    installationId: args.installationId,
    accountLogin: 'compai',
    accountType: 'Organization',
    repos: args.repos,
    suspendedAt: args.suspendedAt ?? null,
  })

const tokensOver = (args: { configured?: boolean } = {}) => {
  if (args.configured === false) {
    return new GithubInstallationTokens(
      new GithubAppClient(new EnvService({})),
      new GithubAppInstallationsService(),
    )
  }
  const { client, installations } = syncServiceWith()
  return new GithubInstallationTokens(client, installations)
}

const mintCalls = (calls: string[]): number =>
  calls.filter((call) => call.endsWith('/access_tokens')).length

let github: ReturnType<typeof fakeGithubApp> | undefined

afterEach(() => {
  github?.restore()
  github = undefined
  setSystemTime()
})

describe('GithubInstallationTokens', () => {
  useTestDatabase()

  it('mints the installation token for a covered repository with one POST', async () => {
    github = fakeGithubApp({ installations: [] })
    await seedCoverage({ installationId: 11n, repos: ['compai/app'] })
    const tokens = tokensOver()

    expect(await tokens.tokenForRepo({ repoFullName: 'compai/app' })).toBe('inst-11')
    expect(github.calls).toEqual(['POST /app/installations/11/access_tokens'])
  })

  it('matches a covered repository regardless of case', async () => {
    github = fakeGithubApp({ installations: [] })
    await seedCoverage({ installationId: 12n, repos: ['compai/app'] })
    const tokens = tokensOver()

    expect(await tokens.tokenForRepo({ repoFullName: 'CompAI/App' })).toBe('inst-12')
  })

  it('reuses the cached token while it is valid', async () => {
    github = fakeGithubApp({ installations: [] })
    await seedCoverage({ installationId: 11n, repos: ['compai/app'] })
    const tokens = tokensOver()

    await tokens.tokenForRepo({ repoFullName: 'compai/app' })
    expect(await tokens.tokenForRepo({ repoFullName: 'compai/app' })).toBe('inst-11')

    expect(mintCalls(github.calls)).toBe(1)
  })

  it('mints once for concurrent requests on one installation', async () => {
    github = fakeGithubApp({ installations: [] })
    await seedCoverage({ installationId: 11n, repos: ['compai/app'] })
    const tokens = tokensOver()

    const both = await Promise.all([
      tokens.tokenForRepo({ repoFullName: 'compai/app' }),
      tokens.tokenForRepo({ repoFullName: 'compai/app' }),
    ])

    expect(both).toEqual(['inst-11', 'inst-11'])
    expect(mintCalls(github.calls)).toBe(1)
  })

  it('mints again once the token is within five minutes of expiring', async () => {
    github = fakeGithubApp({ installations: [] })
    await seedCoverage({ installationId: 11n, repos: ['compai/app'] })
    const tokens = tokensOver()
    const mintedAt = new Date('2026-11-16T00:00:00.000Z')
    setSystemTime(mintedAt)

    await tokens.tokenForRepo({ repoFullName: 'compai/app' })
    setSystemTime(new Date(mintedAt.getTime() + FAKE_TOKEN_LIFETIME_MS - REFRESH_MARGIN_MS + 1_000))
    expect(await tokens.tokenForRepo({ repoFullName: 'compai/app' })).toBe('inst-11')

    expect(mintCalls(github.calls)).toBe(2)
  })

  it('answers undefined for a repository no installation covers, with no GitHub call', async () => {
    github = fakeGithubApp({ installations: [] })
    await seedCoverage({ installationId: 11n, repos: ['compai/other'] })
    const tokens = tokensOver()

    expect(await tokens.tokenForRepo({ repoFullName: 'compai/app' })).toBeUndefined()
    expect(github.calls).toEqual([])
  })

  it('answers undefined for a suspended installation', async () => {
    github = fakeGithubApp({ installations: [] })
    await seedCoverage({
      installationId: 11n,
      repos: ['compai/app'],
      suspendedAt: new Date('2026-11-01T00:00:00Z'),
    })
    const tokens = tokensOver()

    expect(await tokens.tokenForRepo({ repoFullName: 'compai/app' })).toBeUndefined()
    expect(github.calls).toEqual([])
  })

  it('answers undefined without an app configured', async () => {
    github = fakeGithubApp({ installations: [] })
    await seedCoverage({ installationId: 11n, repos: ['compai/app'] })
    const tokens = tokensOver({ configured: false })

    expect(await tokens.tokenForRepo({ repoFullName: 'compai/app' })).toBeUndefined()
    expect(github.calls).toEqual([])
  })

  it('answers undefined on a mint failure and retries on the next request', async () => {
    await seedCoverage({ installationId: 11n, repos: ['compai/app'] })
    const earlier = globalThis.fetch
    let attempts = 0
    globalThis.fetch = (async () => {
      attempts += 1
      return Response.json({ message: 'server error' }, { status: 500 })
    }) as unknown as typeof fetch
    const warn = spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      const tokens = tokensOver()

      expect(await tokens.tokenForRepo({ repoFullName: 'compai/app' })).toBeUndefined()
      expect(await tokens.tokenForRepo({ repoFullName: 'compai/app' })).toBeUndefined()

      expect(attempts).toBe(2)
      expect(warn).toHaveBeenCalledTimes(2)
      expect(String(warn.mock.calls[0]?.[0])).toContain('installation 11')
      expect(String(warn.mock.calls[0]?.[0])).not.toContain('Bearer')
    } finally {
      globalThis.fetch = earlier
      warn.mockRestore()
    }
  })
})
