import { afterEach, describe, expect, it, setSystemTime } from 'bun:test'
import { fakeGithubApp, syncServiceWith } from './github-app-sync.fixture'

const endlessPages = () => {
  const original = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = (async (target: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(
      typeof target === 'string' ? target : target instanceof URL ? target.href : target.url,
    )
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}`)
    if (url.pathname.endsWith('/access_tokens')) {
      return Response.json({
        token: 'inst-11',
        expires_at: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      })
    }
    return Response.json({
      repositories: Array.from({ length: 100 }, (_, index) => ({
        full_name: `compai/repo-${index}`,
      })),
    })
  }) as typeof fetch
  return { calls, restore: () => (globalThis.fetch = original) }
}

let restore: (() => void) | undefined

afterEach(() => {
  restore?.()
  restore = undefined
  setSystemTime()
})

describe('GithubAppClient pagination', () => {
  it('stops after the page cap instead of following pages forever', async () => {
    const endless = endlessPages()
    restore = endless.restore
    const { client } = syncServiceWith()

    await expect(client.installationRepos({ installationId: 11n })).rejects.toThrow(
      'exceeded 50 pages',
    )
    expect(endless.calls.filter((call) => call === 'GET /installation/repositories')).toHaveLength(
      50,
    )
  })

  it('returns a short page without another request', async () => {
    const github = fakeGithubApp({
      installations: [{ id: 11, login: 'compai', repos: ['compai/app'] }],
    })
    restore = github.restore
    const { client } = syncServiceWith()

    expect(await client.installationRepos({ installationId: 11n })).toEqual(['compai/app'])
    expect(github.calls.filter((call) => call === 'GET /installation/repositories')).toHaveLength(1)
  })
})
