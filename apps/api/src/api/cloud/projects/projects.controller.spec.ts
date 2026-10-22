import type { INestApplication } from '@nestjs/common'
import { UnauthorizedException, ValidationPipe, VersioningType } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { SandboxesService } from '../../platform/sandboxes/sandboxes.service'
import { ETokenPrincipalKind } from '../../platform/sandboxes/token-principal'
import { SessionOrSandboxGuard } from '../../platform/sessions/session-or-sandbox.guard'
import { GithubService } from '../github/github.service'
import { seedSessionUsers } from '../web-settings.fake-db'
import { ProjectWorkspaceController } from './project-workspace.controller'
import { ProjectsController } from './projects.controller'
import { ProjectsService } from './projects.service'
import { WorkspaceAccessService } from '../workspaces/workspace-access.service'

const SESSIONS: Record<string, string> = { 'session-a': 'user-a', 'session-b': 'user-b' }
const POD_TOKENS: Record<string, { threadId: string; userId: string }> = {
  'pod-token-a': { threadId: 'thread-pod-a', userId: 'user-a' },
  'pod-token-b': { threadId: 'thread-pod-b', userId: 'user-b' },
}
const SANDBOX_TOKENS: Record<string, { id: string; threadId: string; userId: string }> = {
  'sandbox-token-a': { id: 'sbx-a', threadId: 'thread-sbx-a', userId: 'user-a' },
}
const GITHUB_TOKENS: Record<string, string> = { 'user-a': 'gho_user-a' }

const bearerOf = (req: { headers: { authorization?: string } }): string =>
  (req.headers.authorization ?? '').replace(/^Bearer /i, '')

const BODY = {
  name: 'atlas',
  repo: 'dennisofficial/atlas',
  baseBranch: 'main',
  additionalRepos: [{ repo: 'octocat/Spoon-Knife', branch: 'test-branch' }],
}

describe('projects HTTP surface', () => {
  useTestDatabase()
  let app: INestApplication

  const http = () => request(app.getHttpServer())
  const as = (token: string) => ({ authorization: `Bearer ${token}` })
  const createAsA = async (): Promise<string> => {
    const created = await http().post('/v1/projects').set(as('session-a')).send(BODY).expect(201)
    return created.body.id as string
  }

  beforeEach(async () => {
    await seedSessionUsers()
    const module = await Test.createTestingModule({
      controllers: [ProjectsController, ProjectWorkspaceController],
      providers: [
        ProjectsService,
        WorkspaceAccessService,
        SessionAuthGuard,
        SessionOrSandboxGuard,
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
              return { userId, sessionId: 'ses', email: '', activeOrganizationId: null }
            },
          },
        },
        {
          provide: SandboxesService,
          useValue: {
            async verifyTokenPrincipal(args: { token: string }) {
              const pod = POD_TOKENS[args.token]
              if (pod !== undefined) return { kind: ETokenPrincipalKind.Pod, ...pod }
              const sandbox = SANDBOX_TOKENS[args.token]
              if (sandbox !== undefined) return { kind: ETokenPrincipalKind.Sandbox, ...sandbox }
              throw new UnauthorizedException()
            },
            async assertThreadInFamily() {
              throw new Error('a threadless route must never reach the thread-family check')
            },
          },
        },
      ],
    }).compile()
    app = module.createNestApplication()
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    await app.init()
  })

  afterEach(() => app.close())

  it('runs session CRUD with 201, 200 and 204', async () => {
    const created = await http().post('/v1/projects').set(as('session-a')).send(BODY).expect(201)
    expect(created.body).toMatchObject(BODY)
    const id = created.body.id as string

    const listed = await http().get('/v1/projects').set(as('session-a')).expect(200)
    expect(listed.body).toHaveLength(1)
    await http().get(`/v1/projects/${id}`).set(as('session-a')).expect(200)

    const replaced = await http()
      .put(`/v1/projects/${id}`)
      .set(as('session-a'))
      .send({ ...BODY, name: 'renamed', baseBranch: null })
      .expect(200)
    expect(replaced.body).toMatchObject({ id, name: 'renamed', baseBranch: null })

    await http().delete(`/v1/projects/${id}`).set(as('session-a')).expect(204)
    await http().get(`/v1/projects/${id}`).set(as('session-a')).expect(404)
  })

  it('lets a pod read its owner’s project workspace with the brokered token, uncached', async () => {
    const id = await createAsA()

    const response = await http().get(`/v1/projects/${id}/workspace`).set(as('pod-token-a')).expect(200)

    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body).toEqual({
      projectId: id,
      repo: BODY.repo,
      baseBranch: BODY.baseBranch,
      additionalRepos: BODY.additionalRepos,
      githubToken: 'gho_user-a',
    })
  })

  it('answers githubToken null to a pod whose owner has no github connection', async () => {
    const created = await http().post('/v1/projects').set(as('session-b')).send(BODY).expect(201)

    const response = await http()
      .get(`/v1/projects/${created.body.id}/workspace`)
      .set(as('pod-token-b'))
      .expect(200)

    expect(response.body.githubToken).toBeNull()
  })

  it('answers 404 to a pod reading another user’s project', async () => {
    const id = await createAsA()

    await http().get(`/v1/projects/${id}/workspace`).set(as('pod-token-b')).expect(404)
  })

  it('lets a sandbox bearer read its owner’s project workspace', async () => {
    const id = await createAsA()

    const response = await http().get(`/v1/projects/${id}/workspace`).set(as('sandbox-token-a')).expect(200)

    expect(response.body).toMatchObject({ projectId: id, githubToken: 'gho_user-a' })
  })

  it('answers 401 to a pod bearer on the session-only routes', async () => {
    const id = await createAsA()

    await http().get('/v1/projects').set(as('pod-token-a')).expect(401)
    await http().get(`/v1/projects/${id}`).set(as('pod-token-a')).expect(401)
    await http().post('/v1/projects').set(as('pod-token-a')).send(BODY).expect(401)
  })

  it('rejects a malformed repo, a branch starting with a dash and more than ten extras with 400', async () => {
    const post = (body: object) => http().post('/v1/projects').set(as('session-a')).send(body)
    const extras = Array.from({ length: 11 }, (_, index) => ({ repo: `octocat/repo-${index}` }))

    await post({ ...BODY, repo: 'not a repo' }).expect(400)
    await post({ ...BODY, baseBranch: '-x' }).expect(400)
    await post({ ...BODY, additionalRepos: [{ repo: 'octocat/ok', branch: '-x' }] }).expect(400)
    await post({ ...BODY, additionalRepos: extras }).expect(400)
    await post({ ...BODY, additionalRepos: [{ repo: 'o/..' }] }).expect(400)
    await http().get('/v1/projects').set(as('session-a')).expect(200).expect([])
  })

  it('rejects extras without a primary repo and duplicate repo names with 400', async () => {
    const post = (body: object) => http().post('/v1/projects').set(as('session-a')).send(body)

    await post({ ...BODY, repo: null, baseBranch: null }).expect(400)
    await post({ ...BODY, additionalRepos: [{ repo: 'someone/atlas' }] }).expect(400)
    await post({ ...BODY, additionalRepos: [{ repo: 'a/x' }, { repo: 'b/x' }] }).expect(400)
  })
})
