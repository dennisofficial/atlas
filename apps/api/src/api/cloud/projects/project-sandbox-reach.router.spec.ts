import { db } from '@dltech/atlas-db'
import { seedThread, useTestDatabase } from '@dltech/atlas-db/testing'
import type { INestApplication } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { dataOf, trpcMutation, trpcQuery } from '../session-trpc-test-app'
import { seedSessionUsers } from '../web-settings.fake-db'
import { buildProjectsApp, createProjectAs, PROJECT_BODY } from './projects.router.fixture'

const SANDBOX_TOKEN = 'sbx-token'
const THREAD = 'thr-reach'

describe('project resources reached by a sandbox token', () => {
  useTestDatabase()
  let app: INestApplication
  let own: string
  let other: string

  const query = (args: { path: string; input: object }) =>
    trpcQuery({
      app,
      path: `projectResources.${args.path}`,
      token: SANDBOX_TOKEN,
      input: args.input,
    })
  const mutate = (args: { path: string; input: object }) =>
    trpcMutation({
      app,
      path: `projectResources.${args.path}`,
      token: SANDBOX_TOKEN,
      input: args.input,
    })

  beforeEach(async () => {
    await seedSessionUsers()
    app = await buildProjectsApp({
      githubTokens: { 'user-a': 'gho_a' },
      sandboxTokens: { [SANDBOX_TOKEN]: { id: 'sbx-1', threadId: THREAD, userId: 'user-a' } },
    })
    own = await createProjectAs({ app, token: 'session-a' })
    other = await createProjectAs({
      app,
      token: 'session-a',
      body: { ...PROJECT_BODY, name: 'second' },
    })
    await seedThread({ db, id: THREAD, userId: 'user-a', projectId: own })
  })

  afterEach(() => app.close())

  it('reaches its own project and reveals without a fresh session', async () => {
    await mutate({
      path: 'setFileMount',
      input: { projectId: own, path: '~/a.pem', contents: 'pem' },
    }).expect(200)
    await mutate({
      path: 'setSecret',
      input: { projectId: own, name: 'API', value: 'v' },
    }).expect(200)

    const listed = await query({ path: 'listFileMounts', input: { projectId: own } }).expect(200)
    expect(dataOf(listed.body)).toMatchObject({ mounts: [{ path: '~/a.pem' }] })
    const revealed = await query({
      path: 'revealFileMount',
      input: { projectId: own, path: '~/a.pem' },
    }).expect(200)
    expect(dataOf(revealed.body)).toEqual({ contents: 'pem' })
    const secret = await query({
      path: 'revealSecret',
      input: { projectId: own, name: 'API' },
    }).expect(200)
    expect(dataOf(secret.body)).toEqual({ value: 'v' })
  })

  it('refuses another project of the same user', async () => {
    await query({ path: 'listSecrets', input: { projectId: other } }).expect(403)
    await mutate({
      path: 'setFileMount',
      input: { projectId: other, path: 'a.env', contents: 'x' },
    }).expect(403)
    await mutate({
      path: 'patchSettings',
      input: { projectId: other, values: {} },
    }).expect(403)
  })

  it('keeps sandbox and repo tree routes user-session only', async () => {
    await query({ path: 'getSandbox', input: { projectId: own } }).expect(403)
    await query({ path: 'repoTree', input: { projectId: own } }).expect(403)
  })
})
