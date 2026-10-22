import type { INestApplication } from '@nestjs/common'
import { ValidationPipe, VersioningType } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { GithubRepoReads } from './github-repo-reads'
import { GithubUserReadFailed } from './github-user-reads'
import { GithubReposController } from './github-repos.controller'
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

describe('github repos HTTP surface', () => {
  let app: INestApplication
  const reads = { listRepos: vi.fn(), listBranches: vi.fn() }

  const http = () => request(app.getHttpServer())
  const as = (token: string) => ({ authorization: `Bearer ${token}` })

  beforeEach(async () => {
    reads.listRepos.mockReset()
    reads.listBranches.mockReset()
    const module = await Test.createTestingModule({
      controllers: [GithubReposController],
      providers: [
        SessionAuthGuard,
        {
          provide: GithubService,
          useValue: { findToken: async (args: { userId: string }) => GITHUB_TOKENS[args.userId] },
        },
        { provide: GithubRepoReads, useValue: reads },
        {
          provide: SESSION_VERIFIER,
          useValue: {
            async verify(req: { headers: { authorization?: string } }) {
              const userId = SESSIONS[bearerOf(req)]
              if (userId === undefined) return null
              return { userId, sessionId: 'ses', email: '', activeOrganizationId: null }
            },
          },
        },
      ],
    }).compile()
    app = module.createNestApplication()
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await app.init()
  })

  afterEach(() => app.close())

  describe('GET /v1/github/repos', () => {
    it('answers 401 without a session', async () => {
      await http().get('/v1/github/repos').expect(401)
      expect(reads.listRepos).not.toHaveBeenCalled()
    })

    it('answers 404 github is not connected when the user has no connection', async () => {
      const response = await http().get('/v1/github/repos').set(as('session-b')).expect(404)

      expect(response.body.message).toBe('github is not connected')
      expect(reads.listRepos).not.toHaveBeenCalled()
    })

    it('lists the repos github returns, reading with the user’s own token', async () => {
      reads.listRepos.mockResolvedValue(REPOS)

      const response = await http().get('/v1/github/repos').set(as('session-a')).expect(200)

      expect(response.body).toEqual(REPOS)
      expect(reads.listRepos).toHaveBeenCalledWith({ token: 'gho_user-a' })
    })

    it.each([401, 403, 500])('answers 502 when github answers %i, never 401', async (status) => {
      reads.listRepos.mockRejectedValue(new GithubUserReadFailed('upstream', status))

      const response = await http().get('/v1/github/repos').set(as('session-a')).expect(502)

      expect(response.body.message).toBe('github could not list repositories')
    })

    it('answers 502 when the github call times out', async () => {
      reads.listRepos.mockRejectedValue(new DOMException('timed out', 'TimeoutError'))

      await http().get('/v1/github/repos').set(as('session-a')).expect(502)
    })
  })

  describe('GET /v1/github/repos/:owner/:repo/branches', () => {
    it('answers 401 without a session', async () => {
      await http().get('/v1/github/repos/octocat/Hello-World/branches').expect(401)
    })

    it('answers 404 github is not connected when the user has no connection', async () => {
      const response = await http()
        .get('/v1/github/repos/octocat/Hello-World/branches')
        .set(as('session-b'))
        .expect(404)

      expect(response.body.message).toBe('github is not connected')
    })

    it('lists the branch names of the repo', async () => {
      reads.listBranches.mockResolvedValue(['main', 'feature/x'])

      const response = await http()
        .get('/v1/github/repos/octocat/Hello-World/branches')
        .set(as('session-a'))
        .expect(200)

      expect(response.body).toEqual(['main', 'feature/x'])
      expect(reads.listBranches).toHaveBeenCalledWith({
        token: 'gho_user-a',
        owner: 'octocat',
        repo: 'Hello-World',
      })
    })

    it.each([
      ['an owner with a space', 'bad%20owner/repo'],
      ['an owner with an underscore', 'bad_owner/repo'],
      ['a repo that is only dots', 'octocat/...'],
      ['a repo with a space', 'octocat/bad%20repo'],
    ])('answers 400 for %s without calling github', async (_label, path) => {
      await http().get(`/v1/github/repos/${path}/branches`).set(as('session-a')).expect(400)

      expect(reads.listBranches).not.toHaveBeenCalled()
    })

    it('answers 404 repository not found when github answers 404', async () => {
      reads.listBranches.mockRejectedValue(new GithubUserReadFailed('missing', 404))

      const response = await http()
        .get('/v1/github/repos/octocat/Missing/branches')
        .set(as('session-a'))
        .expect(404)

      expect(response.body.message).toBe('repository not found')
    })

    it.each([401, 403, 500])('answers 502 when github answers %i, never 401', async (status) => {
      reads.listBranches.mockRejectedValue(new GithubUserReadFailed('upstream', status))

      const response = await http()
        .get('/v1/github/repos/octocat/Hello-World/branches')
        .set(as('session-a'))
        .expect(502)

      expect(response.body.message).toBe('github could not list branches')
    })
  })
})
