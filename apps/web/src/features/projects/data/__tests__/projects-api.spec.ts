import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import { createApiClient } from '@dltech/atlas-api-router'

import { createProject } from '@/features/project-settings/data/project-api'
import * as realApiClient from '@/lib/api-client'

let calls: { url: string; init?: RequestInit }[]
const realFetch = globalThis.fetch

const answerWith = (response: Response): void => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), ...(init === undefined ? {} : { init }) })
    return response
  }) as typeof fetch
}

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

let trpcResponse: Response

const fakeTrpcFetch = Object.assign(
  async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ url: String(input), ...(init === undefined ? {} : { init }) })
    return trpcResponse
  },
  { preconnect: fetch.preconnect },
)

mock.module('@/lib/api-client', () => ({
  ...realApiClient,
  api: createApiClient({ baseUrl: '', fetchFn: fakeTrpcFetch }),
}))

const { fetchGithubBranches, fetchGithubRepos } = await import('../github-repos-api')

const trpcOk = (data: unknown): void => {
  trpcResponse = Response.json({ result: { data } })
}

const pathOf = (url: string | undefined): string => new URL(url ?? '', 'http://x').pathname

beforeEach(() => {
  calls = []
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('createProject', () => {
  it('posts the body and parses the created project', async () => {
    const created = {
      id: 'p1',
      name: 'csa',
      repo: 'compai/csa',
      baseBranch: null,
      additionalRepos: [],
      description: '',
      organizationId: 'org1',
      createdAt: '',
      updatedAt: '',
    }
    answerWith(json(created))
    const body = {
      name: 'csa',
      repo: 'compai/csa',
      baseBranch: null,
      additionalRepos: [],
      description: '',
      organizationId: 'org1',
    }
    const project = await createProject(body)
    expect(project.id).toBe('p1')
    expect(calls[0]?.url).toBe('/v1/projects')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(body)
  })

  it('surfaces the API message on failure', async () => {
    answerWith(new Response(JSON.stringify({ message: 'not a member' }), { status: 403 }))
    await expect(
      createProject({
        name: 'x',
        repo: null,
        baseBranch: null,
        additionalRepos: [],
        description: '',
        organizationId: 'nope',
      }),
    ).rejects.toThrow('not a member')
  })
})

describe('fetchGithubRepos', () => {
  it('queries githubRepos.list', async () => {
    trpcOk([{ fullName: 'compai/csa', isPrivate: true, defaultBranch: 'main', pushedAt: null }])
    const repos = await fetchGithubRepos()
    expect(repos[0]?.fullName).toBe('compai/csa')
    expect(pathOf(calls[0]?.url)).toBe('/v1/trpc/githubRepos.list')
    expect(calls[0]?.init?.method ?? 'GET').toBe('GET')
  })

  it('surfaces the API message on failure', async () => {
    trpcResponse = Response.json(
      {
        error: {
          message: 'github is not connected',
          code: -32603,
          data: { code: 'NOT_FOUND', httpStatus: 404 },
        },
      },
      { status: 404 },
    )
    await expect(fetchGithubRepos()).rejects.toMatchObject({ status: 404 })
  })
})

describe('fetchGithubBranches', () => {
  it('queries githubRepos.branches with owner and repo split from the full name', async () => {
    trpcOk(['main', 'dev/x'])
    expect(await fetchGithubBranches('compai/csa')).toEqual(['main', 'dev/x'])
    const url = new URL(calls[0]?.url ?? '', 'http://x')
    expect(url.pathname).toBe('/v1/trpc/githubRepos.branches')
    expect(JSON.parse(url.searchParams.get('input') ?? 'null')).toEqual({
      owner: 'compai',
      repo: 'csa',
    })
    expect(calls[0]?.init?.method ?? 'GET').toBe('GET')
  })
})
