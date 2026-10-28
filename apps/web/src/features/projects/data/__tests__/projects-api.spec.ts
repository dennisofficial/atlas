import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { createApiClient } from '@dltech/atlas-api-router'

import * as realApiClient from '@/lib/api-client'

let calls: { url: string; init?: RequestInit }[]
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

const { createProject } = await import('@/features/project-settings/data/project-api')
const { fetchGithubBranches, fetchGithubRepos } = await import('../github-repos-api')

const answerWith = (response: Response): void => {
  trpcResponse = response
}

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const trpcOk = (data: unknown): void => {
  trpcResponse = Response.json({ result: { data } })
}

const pathOf = (url: string | undefined): string => new URL(url ?? '', 'http://x').pathname

beforeEach(() => {
  calls = []
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
      createdAt: '',
      updatedAt: '',
    }
    answerWith(json({ result: { data: created } }))
    const body = {
      name: 'csa',
      repo: 'compai/csa',
      baseBranch: null,
      additionalRepos: [],
      description: '',
    }
    const project = await createProject(body)
    expect(project.id).toBe('p1')
    expect(calls[0]?.url).toBe('/v1/trpc/projects.create')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(body)
  })

  it('surfaces the API message on failure', async () => {
    answerWith(
      Response.json(
        {
          error: {
            message: 'not allowed',
            code: -32603,
            data: { code: 'FORBIDDEN', httpStatus: 403, details: { message: 'not allowed' } },
          },
        },
        { status: 403 },
      ),
    )
    await expect(
      createProject({
        name: 'x',
        repo: null,
        baseBranch: null,
        additionalRepos: [],
        description: '',
      }),
    ).rejects.toThrow('not allowed')
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
