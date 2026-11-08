import { describe, expect, it } from 'bun:test'

import { GithubPullRequestFinder } from '../finder'

const stub = (args: { body: unknown; status?: number }) => {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify(args.body), { status: args.status ?? 200 })
  }) as typeof fetch
  return { calls, fetcher }
}

const finderOver = (args: { fetcher: typeof fetch; token?: string | null }) =>
  new GithubPullRequestFinder({
    userId: 'u-1',
    github: { read: async () => (args.token === undefined ? 'gho_token' : args.token) },
    fetch: args.fetcher,
  })

const ask = { repo: 'acme/web', branch: 'feat/x', signal: new AbortController().signal }

describe('GithubPullRequestFinder', () => {
  it('asks for pulls headed by the branch in any state, with the user token', async () => {
    const { calls, fetcher } = stub({ body: [] })
    await finderOver({ fetcher }).find(ask)
    expect(calls[0]?.url).toBe(
      'https://api.github.com/repos/acme/web/pulls?head=acme%3Afeat%2Fx&state=all',
    )
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe('Bearer gho_token')
  })

  it('picks the most recently created match', async () => {
    const { fetcher } = stub({
      body: [
        {
          number: 3,
          html_url: 'https://github.com/acme/web/pull/3',
          created_at: '2026-01-01T00:00:00Z',
        },
        {
          number: 9,
          html_url: 'https://github.com/acme/web/pull/9',
          created_at: '2026-03-01T00:00:00Z',
        },
        {
          number: 5,
          html_url: 'https://github.com/acme/web/pull/5',
          created_at: '2026-02-01T00:00:00Z',
        },
      ],
    })
    expect(await finderOver({ fetcher }).find(ask)).toEqual({
      number: 9,
      url: 'https://github.com/acme/web/pull/9',
    })
  })

  it('finds nothing when no pull request matches', async () => {
    const { fetcher } = stub({ body: [] })
    expect(await finderOver({ fetcher }).find(ask)).toBeNull()
  })

  it('does not call GitHub without a token', async () => {
    const { calls, fetcher } = stub({ body: [] })
    expect(await finderOver({ fetcher, token: null }).find(ask)).toBeNull()
    expect(calls).toEqual([])
  })

  it('throws on a GitHub error so the caller logs and links nothing', async () => {
    const { fetcher } = stub({ body: { message: 'nope' }, status: 403 })
    await expect(finderOver({ fetcher }).find(ask)).rejects.toThrow('GitHub answered 403')
  })
})
