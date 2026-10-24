import type { INestApplication } from '@nestjs/common'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { dataOf, trpcMutation, trpcQuery } from '../session-trpc-test-app'
import { seedSessionUsers } from '../web-settings.fake-db'
import { buildProjectsApp, createProjectAs } from './projects.router.fixture'

const BODY = {
  name: 'atlas',
  repo: 'dennisofficial/atlas',
  baseBranch: 'main',
  additionalRepos: [{ repo: 'octocat/Spoon-Knife', branch: 'test-branch' }],
}

describe('projects router', () => {
  useTestDatabase()
  let app: INestApplication

  const create = (token: string, body: object) =>
    trpcMutation({ app, path: 'projects.create', token, input: body })

  beforeEach(async () => {
    await seedSessionUsers()
    app = await buildProjectsApp({
      githubTokens: { 'user-a': 'gho_user-a' },
      podTokens: {
        'pod-token-a': { threadId: 'thread-pod-a', userId: 'user-a' },
        'pod-token-b': { threadId: 'thread-pod-b', userId: 'user-b' },
      },
      sandboxTokens: {
        'sandbox-token-a': { id: 'sbx-a', threadId: 'thread-sbx-a', userId: 'user-a' },
      },
    })
  })

  afterEach(() => app.close())

  it('runs session CRUD and answers 200 for every verb', async () => {
    const created = await create('session-a', BODY).expect(200)
    expect(dataOf(created.body)).toMatchObject(BODY)
    const id = (dataOf(created.body) as { id: string }).id

    const listed = await trpcQuery({ app, path: 'projects.list', token: 'session-a' }).expect(200)
    expect(dataOf(listed.body)).toHaveLength(1)
    await trpcQuery({
      app,
      path: 'projects.get',
      token: 'session-a',
      input: { projectId: id },
    }).expect(200)

    const replaced = await trpcMutation({
      app,
      path: 'projects.update',
      token: 'session-a',
      input: { ...BODY, projectId: id, name: 'renamed', baseBranch: null },
    }).expect(200)
    expect(dataOf(replaced.body)).toMatchObject({ id, name: 'renamed', baseBranch: null })

    const removed = await trpcMutation({
      app,
      path: 'projects.remove',
      token: 'session-a',
      input: { projectId: id },
    }).expect(200)
    expect(dataOf(removed.body)).toBeUndefined()
    await trpcQuery({
      app,
      path: 'projects.get',
      token: 'session-a',
      input: { projectId: id },
    }).expect(404)
  })

  it('answers every project call uncached', async () => {
    const listed = await trpcQuery({ app, path: 'projects.list', token: 'session-a' }).expect(200)
    expect(listed.headers['cache-control']).toBe('no-store')
  })

  it('lets a pod read its owner’s project workspace with the brokered token, uncached', async () => {
    const id = await createProjectAs({ app, token: 'session-a', body: BODY })

    const response = await trpcQuery({
      app,
      path: 'projectWorkspace.get',
      token: 'pod-token-a',
      input: { projectId: id },
    }).expect(200)

    expect(response.headers['cache-control']).toBe('no-store')
    expect(dataOf(response.body)).toEqual({
      projectId: id,
      repo: BODY.repo,
      baseBranch: BODY.baseBranch,
      additionalRepos: BODY.additionalRepos,
      githubToken: 'gho_user-a',
    })
  })

  it('answers githubToken null to a pod whose owner has no github connection', async () => {
    const id = await createProjectAs({ app, token: 'session-b', body: BODY })

    const response = await trpcQuery({
      app,
      path: 'projectWorkspace.get',
      token: 'pod-token-b',
      input: { projectId: id },
    }).expect(200)

    expect(dataOf(response.body)).toMatchObject({ githubToken: null })
  })

  it('answers 404 to a pod reading another user’s project', async () => {
    const id = await createProjectAs({ app, token: 'session-a', body: BODY })

    await trpcQuery({
      app,
      path: 'projectWorkspace.get',
      token: 'pod-token-b',
      input: { projectId: id },
    }).expect(404)
  })

  it('lets a sandbox bearer read its owner’s project workspace', async () => {
    const id = await createProjectAs({ app, token: 'session-a', body: BODY })

    const response = await trpcQuery({
      app,
      path: 'projectWorkspace.get',
      token: 'sandbox-token-a',
      input: { projectId: id },
    }).expect(200)

    expect(dataOf(response.body)).toMatchObject({ projectId: id, githubToken: 'gho_user-a' })
  })

  it('answers 401 to a pod bearer on the session-only routes', async () => {
    const id = await createProjectAs({ app, token: 'session-a', body: BODY })
    const input = { projectId: id }

    await trpcQuery({ app, path: 'projects.list', token: 'pod-token-a' }).expect(401)
    await trpcQuery({ app, path: 'projects.get', token: 'pod-token-a', input }).expect(401)
    await create('pod-token-a', BODY).expect(401)
  })

  it('answers 401 to a missing token on the workspace route', async () => {
    await trpcQuery({
      app,
      path: 'projectWorkspace.get',
      input: { projectId: 'p' },
    }).expect(401)
  })

  it('rejects a malformed repo, a branch starting with a dash and more than ten extras with 400', async () => {
    const extras = Array.from({ length: 11 }, (_, index) => ({ repo: `octocat/repo-${index}` }))

    await create('session-a', { ...BODY, repo: 'not a repo' }).expect(400)
    await create('session-a', { ...BODY, baseBranch: '-x' }).expect(400)
    await create('session-a', {
      ...BODY,
      additionalRepos: [{ repo: 'octocat/ok', branch: '-x' }],
    }).expect(400)
    await create('session-a', { ...BODY, additionalRepos: extras }).expect(400)
    await create('session-a', { ...BODY, additionalRepos: [{ repo: 'o/..' }] }).expect(400)
    const listed = await trpcQuery({ app, path: 'projects.list', token: 'session-a' }).expect(200)
    expect(dataOf(listed.body)).toEqual([])
  })

  it('rejects extras without a primary repo and duplicate repo names with 400', async () => {
    await create('session-a', { ...BODY, repo: null, baseBranch: null }).expect(400)
    await create('session-a', { ...BODY, additionalRepos: [{ repo: 'someone/atlas' }] }).expect(400)
    await create('session-a', {
      ...BODY,
      additionalRepos: [{ repo: 'a/x' }, { repo: 'b/x' }],
    }).expect(400)
  })

  it('rejects an unknown body property with 400', async () => {
    await create('session-a', { ...BODY, owner: 'user-b' }).expect(400)
    await trpcMutation({
      app,
      path: 'projects.remove',
      token: 'session-a',
      input: { projectId: 'p', extra: true },
    }).expect(400)
  })
})
