import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import { createApiClient } from '@dltech/atlas-api-router'

import * as realApiClient from '@/lib/api-client'

mock.module('@/lib/api-client', () => ({
  ...realApiClient,
  api: createApiClient({
    baseUrl: '',
    fetchFn: Object.assign(
      (input: Parameters<typeof fetch>[0], init?: RequestInit) => globalThis.fetch(input, init),
      { preconnect: fetch.preconnect },
    ),
  }),
}))

const { createProject } = await import('@/features/project-settings/data/project-api')
const { fetchGithubBranches, fetchGithubRepos } = await import('../github-repos-api')

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
    answerWith(json({ result: { data: created } }))
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
    expect(calls[0]?.url).toBe('/v1/trpc/projects.create')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(body)
  })

  it('surfaces the API message on failure', async () => {
    answerWith(
      Response.json(
        {
          error: {
            message: 'not a member',
            code: -32603,
            data: { code: 'FORBIDDEN', httpStatus: 403, details: { message: 'not a member' } },
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
        organizationId: 'nope',
      }),
    ).rejects.toThrow('not a member')
  })
})

describe('fetchGithubRepos', () => {
  it('gets the repo list', async () => {
    answerWith(
      json([{ fullName: 'compai/csa', isPrivate: true, defaultBranch: 'main', pushedAt: null }]),
    )
    const repos = await fetchGithubRepos()
    expect(repos[0]?.fullName).toBe('compai/csa')
    expect(calls[0]?.url).toBe('/v1/github/repos')
    expect(calls[0]?.init?.method).toBe('GET')
  })
})

describe('fetchGithubBranches', () => {
  it('gets the branches of one repo', async () => {
    answerWith(json(['main', 'dev/x']))
    expect(await fetchGithubBranches('compai/csa')).toEqual(['main', 'dev/x'])
    expect(calls[0]?.url).toBe('/v1/github/repos/compai/csa/branches')
    expect(calls[0]?.init?.method).toBe('GET')
  })
})
