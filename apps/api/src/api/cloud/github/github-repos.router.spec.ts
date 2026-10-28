import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'bun:test'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import {
  as,
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import { GithubRepoReads } from './github-repo-reads'
import { GithubUserReadFailed } from './github-user-reads'
import { GithubReposRouter } from './github-repos.router'
import { GithubService } from './github.service'

const SESSIONS: Record<string, string> = { 'session-a': 'user-a', 'session-b': 'user-b' }
const GITHUB_TOKENS: Record<string, string> = { 'user-a': 'gho_user-a' }

const REPOS = [
  {
    fullName: 'octocat/Hello-World',
    isPrivate: false,
    defaultBranch: 'main',
    pushedAt: '2026-10-20T10:00:00Z',
  },
  { fullName: 'acme/secret', isPrivate: true, defaultBranch: 'trunk', pushedAt: null },
]

const bearerOf = (req: { headers: { authorization?: string } }): string =>
  (req.headers.authorization ?? '').replace(/^Bearer /i, '')

const branchesInput = (input: { owner: string; repo: string }): string =>
  `?input=${encodeURIComponent(JSON.stringify(input))}`

describe('GithubReposRouter', () => {
  let app: INestApplication
  const reads = { listRepos: vi.fn(), listBranches: vi.fn() }

  const list = (token?: string) => {
    const call = request(app.getHttpServer()).get('/v1/trpc/githubRepos.list')
    return token === undefined ? call : call.set(as(token))
  }
  const branches = (input: { owner: string; repo: string }, token?: string) => {
    const call = request(app.getHttpServer()).get(
      `/v1/trpc/githubRepos.branches${branchesInput(input)}`,
    )
    return token === undefined ? call : call.set(as(token))
  }

  beforeAll(async () => {
    app = await createMiddlewareApp({
      rateLimit: UNTHROTTLED_RATE_LIMIT,
      providers: [
        GithubReposRouter,
        SessionMiddleware,
        { provide: GithubRepoReads, useValue: reads },
        {
          provide: GithubService,
          useValue: { findToken: async (args: { userId: string }) => GITHUB_TOKENS[args.userId] },
        },
        {
          provide: SESSION_VERIFIER,
          useValue: {
            async verify(req: { headers: { authorization?: string } }) {
              const userId = SESSIONS[bearerOf(req)]
              if (userId === undefined) return null
              return { userId, sessionId: 'ses', email: '' }
            },
          },
        },
      ],
    })
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    reads.listRepos.mockReset()
    reads.listBranches.mockReset()
  })

  describe('githubRepos.list', () => {
    it('answers 401 without a session', async () => {
      const reply = await list()

      expect(reply.status).toBe(401)
      expect(reads.listRepos).not.toHaveBeenCalled()
    })

    it('answers 404 github is not connected when the user has no connection', async () => {
      const reply = await list('session-b')

      expect(reply.status).toBe(404)
      expect(reply.body.error.data.httpStatus).toBe(404)
      expect(reply.body.error.message).toBe('github is not connected')
      expect(reads.listRepos).not.toHaveBeenCalled()
    })

    it('lists the repos github returns, reading with the user’s own token', async () => {
      reads.listRepos.mockResolvedValue(REPOS)

      const reply = await list('session-a')

      expect(reply.status).toBe(200)
      expect(reply.body).toEqual({ result: { data: REPOS } })
      expect(reads.listRepos).toHaveBeenCalledWith({ token: 'gho_user-a' })
    })

    it.each([401, 403, 500])('answers 502 when github answers %i, never 401', async (status) => {
      reads.listRepos.mockRejectedValue(new GithubUserReadFailed('upstream', status))

      const reply = await list('session-a')

      expect(reply.status).toBe(502)
      expect(reply.body.error.data.httpStatus).toBe(502)
      expect(reply.body.error.message).toBe('github could not list repositories')
    })

    it('answers 502 when the github call times out', async () => {
      reads.listRepos.mockRejectedValue(new DOMException('timed out', 'TimeoutError'))

      const reply = await list('session-a')

      expect(reply.status).toBe(502)
    })
  })

  describe('githubRepos.branches', () => {
    const HELLO = { owner: 'octocat', repo: 'Hello-World' }

    it('answers 401 without a session', async () => {
      expect((await branches(HELLO)).status).toBe(401)
    })

    it('answers 404 github is not connected when the user has no connection', async () => {
      const reply = await branches(HELLO, 'session-b')

      expect(reply.status).toBe(404)
      expect(reply.body.error.message).toBe('github is not connected')
    })

    it('lists the branch names of the repo', async () => {
      reads.listBranches.mockResolvedValue(['main', 'feature/x'])

      const reply = await branches(HELLO, 'session-a')

      expect(reply.status).toBe(200)
      expect(reply.body).toEqual({ result: { data: ['main', 'feature/x'] } })
      expect(reads.listBranches).toHaveBeenCalledWith({ token: 'gho_user-a', ...HELLO })
    })

    it.each([
      ['an owner with a space', { owner: 'octo cat', repo: 'repo' }],
      ['an owner with an underscore', { owner: 'bad_owner', repo: 'repo' }],
      ['a repo that is only dots', { owner: 'octocat', repo: '..' }],
      ['a repo with a space', { owner: 'octocat', repo: 'bad repo' }],
    ])('answers 400 for %s without calling github', async (_label, input) => {
      const reply = await branches(input, 'session-a')

      expect(reply.status).toBe(400)
      expect(reply.body.error.data.httpStatus).toBe(400)
      expect(reads.listBranches).not.toHaveBeenCalled()
    })

    it('answers 404 repository not found when github answers 404', async () => {
      reads.listBranches.mockRejectedValue(new GithubUserReadFailed('missing', 404))

      const reply = await branches({ owner: 'octocat', repo: 'Missing' }, 'session-a')

      expect(reply.status).toBe(404)
      expect(reply.body.error.message).toBe('repository not found')
    })

    it.each([401, 403, 500])('answers 502 when github answers %i, never 401', async (status) => {
      reads.listBranches.mockRejectedValue(new GithubUserReadFailed('upstream', status))

      const reply = await branches(HELLO, 'session-a')

      expect(reply.status).toBe(502)
      expect(reply.body.error.message).toBe('github could not list branches')
    })
  })
})
