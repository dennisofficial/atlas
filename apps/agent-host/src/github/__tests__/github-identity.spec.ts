import { describe, expect, it } from 'bun:test'

import { githubIdentityLookup } from '../github-identity'

const stub = (args: { body: unknown; status?: number }) => {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify(args.body), { status: args.status ?? 200 })
  }) as typeof fetch
  return { calls, fetcher }
}

const ask = { token: 'gho_token', signal: new AbortController().signal }

describe('githubIdentityLookup', () => {
  it('builds the noreply identity from the authenticated user', async () => {
    const { calls, fetcher } = stub({ body: { id: 583231, login: 'octocat' } })
    const identity = await githubIdentityLookup({ fetch: fetcher })(ask)
    expect(identity).toEqual({
      name: 'octocat',
      email: '583231+octocat@users.noreply.github.com',
    })
    expect(calls[0]?.url).toBe('https://api.github.com/user')
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe('Bearer gho_token')
  })

  it('rejects when GitHub refuses the token', async () => {
    const { fetcher } = stub({ body: {}, status: 401 })
    await expect(githubIdentityLookup({ fetch: fetcher })(ask)).rejects.toThrow('401')
  })

  it('rejects a body without an id', async () => {
    const { fetcher } = stub({ body: { login: 'octocat' } })
    await expect(githubIdentityLookup({ fetch: fetcher })(ask)).rejects.toThrow()
  })
})
