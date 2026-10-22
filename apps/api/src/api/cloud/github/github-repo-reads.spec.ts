import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { stubGlobal, unstubAllGlobals } from '@dltech/bun-test-shims'
import { GithubRepoReads } from './github-repo-reads'
import { GithubUserReadFailed } from './github-user-reads'

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status })

describe('GithubRepoReads', () => {
  let reads: GithubRepoReads
  let fetchStub: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchStub = vi.fn()
    stubGlobal('fetch', fetchStub)
    reads = new GithubRepoReads()
  })

  afterEach(() => {
    unstubAllGlobals()
  })

  describe('listRepos', () => {
    it('asks github for the most recently pushed repos the user can reach, as the user', async () => {
      fetchStub.mockResolvedValue(json([]))

      await reads.listRepos({ token: 'gho_abc' })

      const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(
        'https://api.github.com/user/repos?sort=pushed&direction=desc&per_page=100&affiliation=owner,collaborator,organization_member',
      )
      expect(init.headers).toEqual({
        authorization: 'Bearer gho_abc',
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      })
      expect(init.signal).toBeInstanceOf(AbortSignal)
    })

    it('maps github repos to summaries, keeping a null pushed_at', async () => {
      fetchStub.mockResolvedValue(
        json([
          {
            id: 1,
            full_name: 'octocat/Hello-World',
            private: false,
            default_branch: 'main',
            pushed_at: '2026-10-20T10:00:00Z',
            description: 'ignored',
          },
          { full_name: 'acme/secret', private: true, default_branch: 'trunk', pushed_at: null },
        ]),
      )

      const repos = await reads.listRepos({ token: 't' })

      expect(repos).toEqual([
        {
          fullName: 'octocat/Hello-World',
          isPrivate: false,
          defaultBranch: 'main',
          pushedAt: '2026-10-20T10:00:00Z',
        },
        { fullName: 'acme/secret', isPrivate: true, defaultBranch: 'trunk', pushedAt: null },
      ])
    })

    it('throws GithubUserReadFailed carrying the github status', async () => {
      fetchStub.mockResolvedValue(new Response('bad credentials', { status: 401 }))

      const failure = await reads.listRepos({ token: 't' }).catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(GithubUserReadFailed)
      expect((failure as GithubUserReadFailed).status).toBe(401)
    })
  })

  describe('listBranches', () => {
    it('lists the first hundred branches of the repo', async () => {
      fetchStub.mockResolvedValue(json([]))

      await reads.listBranches({ token: 'gho_abc', owner: 'octocat', repo: 'Hello-World' })

      const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://api.github.com/repos/octocat/Hello-World/branches?per_page=100')
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer gho_abc')
    })

    it('returns the branch names only', async () => {
      fetchStub.mockResolvedValue(
        json([
          { name: 'main', protected: true, commit: { sha: 'a' } },
          { name: 'feature/x', protected: false, commit: { sha: 'b' } },
        ]),
      )

      const branches = await reads.listBranches({ token: 't', owner: 'o', repo: 'r' })

      expect(branches).toEqual(['main', 'feature/x'])
    })

    it('throws GithubUserReadFailed with 404 when the repo is not visible', async () => {
      fetchStub.mockResolvedValue(new Response('{"message":"Not Found"}', { status: 404 }))

      const failure = await reads
        .listBranches({ token: 't', owner: 'o', repo: 'r' })
        .catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(GithubUserReadFailed)
      expect((failure as GithubUserReadFailed).status).toBe(404)
    })
  })
})
