import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { encodeSettingValue } from '@dltech/atlas-wire/web'
import type { INestApplication } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { dataOf, trpcMutation, trpcQuery } from '../session-trpc-test-app'
import { seedSessionUsers, seedWorkspace } from '../web-settings.fake-db'
import { buildProjectsApp, createProjectAs, PROJECT_BODY } from './projects.router.fixture'

describe('project settings and workspace link router', () => {
  useTestDatabase()
  let app: INestApplication

  const create = (body: object) =>
    trpcMutation({ app, path: 'projects.create', token: 'session-a', input: body })
  const update = (input: object) =>
    trpcMutation({ app, path: 'projects.update', token: 'session-a', input })
  const patch = (args: { projectId: string; values: object; token?: string }) =>
    trpcMutation({
      app,
      path: 'projectResources.patchSettings',
      token: args.token ?? 'session-a',
      input: { projectId: args.projectId, values: args.values },
    })
  const list = (args: { projectId: string; token?: string }) =>
    trpcQuery({
      app,
      path: 'projectResources.listSettings',
      token: args.token ?? 'session-a',
      input: { projectId: args.projectId },
    })

  beforeEach(async () => {
    await seedSessionUsers()
    await seedWorkspace({ id: 'org-1', members: [{ userId: 'user-a', role: 'member' }] })
    app = await buildProjectsApp({})
  })

  afterEach(() => app.close())

  it('links a project to a workspace the caller belongs to, and keeps it when update omits it', async () => {
    await create({ ...PROJECT_BODY, organizationId: 'org-2' }).expect(404)
    const created = await create({ ...PROJECT_BODY, organizationId: 'org-1' }).expect(200)
    const projectId = (dataOf(created.body) as { id: string }).id
    expect(dataOf(created.body)).toMatchObject({ organizationId: 'org-1' })

    const renamed = await update({ ...PROJECT_BODY, projectId, name: 'renamed' }).expect(200)
    expect(dataOf(renamed.body)).toMatchObject({ organizationId: 'org-1' })

    const unlinked = await update({ ...PROJECT_BODY, projectId, organizationId: null }).expect(200)
    expect(dataOf(unlinked.body)).toMatchObject({ organizationId: null })
  })

  it('defaults organizationId to null', async () => {
    const created = await create(PROJECT_BODY).expect(200)
    expect(dataOf(created.body)).toMatchObject({ organizationId: null })
  })

  it('patches and lists project settings against the project registry', async () => {
    const projectId = await createProjectAs({ app, token: 'session-a' })

    const patched = await patch({
      projectId,
      values: { 'model.effort': encodeSettingValue('high') },
    }).expect(200)
    expect(dataOf(patched.body)).toBeUndefined()
    await patch({
      projectId,
      values: { 'sandbox.vercelProjectId': encodeSettingValue('prj_1') },
    }).expect(400)
    await patch({
      projectId,
      values: { 'sandbox.vercelTeamId': encodeSettingValue('t') },
    }).expect(400)
    await patch({ projectId, values: { 'model.effort': encodeSettingValue('ultra') } }).expect(400)
    await patch({ projectId, values: {} }).expect(400)

    const read = await list({ projectId }).expect(200)
    const { settings } = dataOf(read.body) as { settings: { key: string }[] }
    expect(settings.map((entry) => entry.key)).toEqual(['model.effort'])

    await patch({ projectId, values: { 'model.effort': null } }).expect(200)
    expect(await db.orm.public.ProjectSetting.where((row) => row.id.neq('')).all()).toHaveLength(0)
  })

  it('404s another user on project settings', async () => {
    const projectId = await createProjectAs({ app, token: 'session-a' })
    await list({ projectId, token: 'session-b' }).expect(404)
    await patch({
      projectId,
      token: 'session-b',
      values: { 'model.effort': encodeSettingValue('high') },
    }).expect(404)
  })

  it('rejects an unknown property on a patch with 400', async () => {
    const projectId = await createProjectAs({ app, token: 'session-a' })
    await trpcMutation({
      app,
      path: 'projectResources.patchSettings',
      token: 'session-a',
      input: { projectId, values: {}, extra: 1 },
    }).expect(400)
  })
})
