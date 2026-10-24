import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { INestApplication } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { dataOf, trpcMutation, trpcQuery } from '../session-trpc-test-app'
import { seedSessionUsers, seedWorkspace } from '../web-settings.fake-db'
import { buildWorkspacesApp, ORG } from './workspaces.router.fixture'

const credential = () => db.orm.public.WorkspaceVercelCredential.first({ organizationId: ORG })

describe('workspace vercel credential router', () => {
  useTestDatabase()
  let app: INestApplication

  const read = (token: string) =>
    trpcQuery({ app, path: 'workspaces.getVercel', token, input: { organizationId: ORG } })
  const save = (args: { body: object; token?: string }) =>
    trpcMutation({
      app,
      path: 'workspaces.saveVercel',
      token: args.token ?? 'session-a',
      input: { organizationId: ORG, ...args.body },
    })
  const remove = (token: string) =>
    trpcMutation({ app, path: 'workspaces.removeVercel', token, input: { organizationId: ORG } })

  beforeEach(async () => {
    await seedSessionUsers()
    await seedWorkspace({
      id: ORG,
      members: [
        { userId: 'user-a', role: 'owner' },
        { userId: 'user-b', role: 'member' },
      ],
    })
    app = await buildWorkspacesApp()
  })

  afterEach(() => app.close())

  it('reads unconfigured, saves a sealed token and never returns it', async () => {
    const empty = await read('session-b').expect(200)
    expect(dataOf(empty.body)).toEqual({
      configured: false,
      teamId: null,
      vercelProjectId: null,
      updatedAt: null,
    })

    await save({
      body: { token: 'vtok_secret', teamId: 'team_1', vercelProjectId: 'prj_1' },
    }).expect(200)
    expect(await credential()).toMatchObject({ teamId: 'team_1', vercelProjectId: 'prj_1' })
    expect((await credential())?.sealedToken).not.toContain('vtok_secret')

    const configured = await read('session-b').expect(200)
    expect(dataOf(configured.body)).toMatchObject({
      configured: true,
      teamId: 'team_1',
      vercelProjectId: 'prj_1',
    })
    expect(JSON.stringify(configured.body)).not.toContain('vtok')
  })

  it('keeps the token when a later save omits it, and needs one the first time', async () => {
    await save({ body: { teamId: 'team_1', vercelProjectId: 'prj_1' } }).expect(400)
    await save({
      body: { token: 'vtok_1', teamId: 'team_1', vercelProjectId: 'prj_1' },
    }).expect(200)
    const sealed = (await credential())?.sealedToken
    await save({ body: { teamId: 'team_2', vercelProjectId: 'prj_2' } }).expect(200)
    expect(await credential()).toMatchObject({
      teamId: 'team_2',
      vercelProjectId: 'prj_2',
      sealedToken: sealed,
    })
  })

  it('limits writes to owners and admins, and 404s outsiders', async () => {
    await save({
      token: 'session-b',
      body: { token: 't', teamId: 'x', vercelProjectId: 'p' },
    }).expect(403)
    await remove('session-b').expect(403)
    await read('session-c').expect(404)
  })

  it('requires the vercel project id, rejects a malformed body and deletes the credential', async () => {
    await save({ body: { token: '', teamId: 'team_1', vercelProjectId: 'prj_1' } }).expect(400)
    await save({ body: { token: 't' } }).expect(400)
    await save({ body: { token: 't', teamId: 'team_1' } }).expect(400)
    await save({ body: { token: 't', teamId: 'team_1', vercelProjectId: '  ' } }).expect(400)
    await save({ body: { token: 't', teamId: 'team_1', vercelProjectId: 'prj_1' } }).expect(200)
    await remove('session-a').expect(200)
    expect(await credential()).toBeNull()
  })
})
