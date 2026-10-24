import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { createApiClient } from '@dltech/atlas-api-router'

import * as realApiClient from '@/lib/api-client'

let calls: { url: string; init?: RequestInit }[]
let response: Response

const fakeFetch = Object.assign(
  async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ url: String(input), ...(init === undefined ? {} : { init }) })
    return response
  },
  { preconnect: fetch.preconnect },
)

mock.module('@/lib/api-client', () => ({
  ...realApiClient,
  api: createApiClient({ baseUrl: '', fetchFn: fakeFetch }),
}))

const { fetchGithub, githubLoginOf } = await import('../github-api')

const trpcOk = (data: unknown): void => {
  response = Response.json({ result: { data } })
}

beforeEach(() => {
  calls = []
})

describe('github api', () => {
  it('reads the connection from github.get', async () => {
    const connected = {
      connected: true as const,
      login: 'octocat',
      scopes: ['repo'],
      connectedAt: '2026-01-01T00:00:00.000Z',
    }
    trpcOk(connected)
    const connection = await fetchGithub()
    expect(connection).toEqual(connected)
    expect(githubLoginOf(connection)).toBe('octocat')
    expect(new URL(calls[0]?.url ?? '', 'http://x').pathname).toBe('/v1/trpc/github.get')
    expect(calls[0]?.init?.method ?? 'GET').toBe('GET')
  })

  it('reports a disconnected account without a login', async () => {
    trpcOk({ connected: false })
    const connection = await fetchGithub()
    expect(connection).toEqual({ connected: false })
    expect(githubLoginOf(connection)).toBeNull()
  })

  it('throws a CloudApiError carrying the http status', async () => {
    response = Response.json(
      {
        error: {
          message: 'cloud is down',
          code: -32603,
          data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 },
        },
      },
      { status: 500 },
    )
    await expect(fetchGithub()).rejects.toMatchObject({ status: 500 })
  })
})
