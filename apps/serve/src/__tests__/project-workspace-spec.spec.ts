import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { projectWorkspaceSpecFetcher } from '../project-workspace-spec'

const homes: string[] = []

const homeWith = (bootstrap: Record<string, unknown>): string => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-project-spec-'))
  homes.push(home)
  mkdirSync(join(home, 'bootstrap'), { recursive: true })
  writeFileSync(join(home, 'bootstrap', 'workspace-spec.json'), JSON.stringify(bootstrap))
  return home
}

afterEach(() => {
  for (const home of homes.splice(0, homes.length)) rmSync(home, { recursive: true, force: true })
})

const WORKSPACE = {
  projectId: 'proj-1',
  repo: 'octocat/Hello-World',
  baseBranch: 'test',
  additionalRepos: [{ repo: 'octocat/Spoon-Knife', branch: 'test-branch' }],
  githubToken: 'gho_brokered',
}

type Call = { url: string; authorization: string | null }

const fetcherWith = (args: {
  home: string
  answers: Array<() => Response>
  sleeps?: number[]
  retryBudgetMs?: number
  requestMs?: number
}) => {
  const calls: Call[] = []
  let clock = 0
  const fetchSpec = projectWorkspaceSpecFetcher({
    atlasHome: args.home,
    controlPlaneUrl: 'https://api.example.com/',
    token: 'serve-token',
    clientVersion: 'dev',
    retryBudgetMs: args.retryBudgetMs,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms
      args.sleeps?.push(ms)
    },
    fetchFn: (async (input: unknown, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>
      clock += args.requestMs ?? 0
      calls.push({ url: String(input), authorization: headers.authorization ?? null })
      const answer = args.answers[Math.min(calls.length, args.answers.length) - 1]
      if (answer === undefined) throw new Error('no answer scripted')
      return answer()
    }) as typeof fetch,
  })
  return { fetchSpec, calls }
}

describe('projectWorkspaceSpecFetcher', () => {
  it('answers an empty workspace, with no request, when the bootstrap names no project', async () => {
    const home = homeWith({
      remoteUrl: 'git@github.com:a/b.git',
      githubToken: 'laptop',
      model: 'm',
    })
    const { fetchSpec, calls } = fetcherWith({ home, answers: [] })

    await expect(fetchSpec()).resolves.toEqual({ remoteUrl: null, githubToken: null, model: 'm' })
    expect(calls).toEqual([])
  })

  it('answers an empty workspace for a null project id', async () => {
    const home = homeWith({ remoteUrl: null, githubToken: null, projectId: null })
    const { fetchSpec, calls } = fetcherWith({ home, answers: [] })

    await expect(fetchSpec()).resolves.toEqual({
      remoteUrl: null,
      githubToken: null,
      model: undefined,
    })
    expect(calls).toEqual([])
  })

  it('reads the project workspace with the serve token and merges it over the bootstrap', async () => {
    const home = homeWith({
      remoteUrl: null,
      githubToken: 'laptop',
      model: 'claude-x',
      projectId: 'proj-1',
    })
    const { fetchSpec, calls } = fetcherWith({ home, answers: [() => Response.json(WORKSPACE)] })

    await expect(fetchSpec()).resolves.toEqual({
      remoteUrl: 'https://github.com/octocat/Hello-World.git',
      githubToken: 'gho_brokered',
      model: 'claude-x',
      projectId: 'proj-1',
      baseBranch: 'test',
      additionalRepos: [{ repo: 'octocat/Spoon-Knife', branch: 'test-branch' }],
    })
    expect(calls).toEqual([
      {
        url: 'https://api.example.com/v1/projects/proj-1/workspace',
        authorization: 'Bearer serve-token',
      },
    ])
  })

  it('maps a project with no repo to no remote and keeps a null token', async () => {
    const home = homeWith({ remoteUrl: null, githubToken: null, projectId: 'proj-1' })
    const { fetchSpec } = fetcherWith({
      home,
      answers: [
        () =>
          Response.json({
            ...WORKSPACE,
            repo: null,
            baseBranch: null,
            additionalRepos: [],
            githubToken: null,
          }),
      ],
    })

    await expect(fetchSpec()).resolves.toMatchObject({
      remoteUrl: null,
      githubToken: null,
      baseBranch: null,
    })
  })

  it('retries a 401 after two seconds until the lease lands', async () => {
    const home = homeWith({ remoteUrl: null, githubToken: null, projectId: 'proj-1' })
    const sleeps: number[] = []
    const { fetchSpec, calls } = fetcherWith({
      home,
      sleeps,
      answers: [
        () => new Response('no', { status: 401 }),
        () => new Response('no', { status: 401 }),
        () => Response.json(WORKSPACE),
      ],
    })

    await expect(fetchSpec()).resolves.toMatchObject({
      projectId: 'proj-1',
      githubToken: 'gho_brokered',
    })
    expect(calls).toHaveLength(3)
    expect(sleeps).toEqual([2000, 2000])
  })

  it('gives up on a persistent 401 once the budget is spent', async () => {
    const home = homeWith({ remoteUrl: null, githubToken: null, projectId: 'proj-1' })
    const sleeps: number[] = []
    const { fetchSpec, calls } = fetcherWith({
      home,
      sleeps,
      retryBudgetMs: 6000,
      answers: [() => new Response('no', { status: 401 })],
    })

    await expect(fetchSpec()).rejects.toThrow('with 401')
    expect(sleeps).toEqual([2000, 2000, 2000])
    expect(calls).toHaveLength(4)
  })

  it('counts request time against the budget, not just the sleeps', async () => {
    const home = homeWith({ remoteUrl: null, githubToken: null, projectId: 'proj-1' })
    const { fetchSpec, calls } = fetcherWith({
      home,
      requestMs: 5000,
      answers: [() => new Response('no', { status: 401 })],
    })

    await expect(fetchSpec()).rejects.toThrow('with 401')
    expect(calls.length).toBeLessThanOrEqual(9)
    expect(calls.length).toBeGreaterThan(1)
  })

  it('does not retry a 404', async () => {
    const home = homeWith({ remoteUrl: null, githubToken: null, projectId: 'proj-1' })
    const sleeps: number[] = []
    const { fetchSpec, calls } = fetcherWith({
      home,
      sleeps,
      answers: [() => new Response('gone', { status: 404 })],
    })

    await expect(fetchSpec()).rejects.toThrow('with 404')
    expect(calls).toHaveLength(1)
    expect(sleeps).toEqual([])
  })

  it('encodes the project id into the path', async () => {
    const home = homeWith({ remoteUrl: null, githubToken: null, projectId: 'a/b c' })
    const { fetchSpec, calls } = fetcherWith({
      home,
      answers: [() => new Response('x', { status: 404 })],
    })

    await fetchSpec().catch(() => undefined)

    expect(calls[0]?.url).toBe('https://api.example.com/v1/projects/a%2Fb%20c/workspace')
  })
})
