import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { INestApplication } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { seedSessionUsers } from '../../../test/web-settings.fake-db'
import { createProjectAs } from '../projects/projects.router.fixture'
import { trpcQuery, trpcMutation } from '../session-trpc-test-app'
import {
  accessGrantApi,
  buildAccessGrantsApp,
  groupScope,
  projectScope,
  savedId,
} from './access-grants.router.fixture'

describe('access grants at group scope', () => {
  useTestDatabase()
  let app: INestApplication
  let api: ReturnType<typeof accessGrantApi>
  let groupId: string

  const createGroup = async (name: string): Promise<string> => {
    const response = await trpcMutation({
      app,
      path: 'projectGroups.save',
      token: 'session-a',
      input: { name },
    }).expect(200)
    return savedId(response.body)
  }

  beforeEach(async () => {
    await seedSessionUsers()
    app = await buildAccessGrantsApp()
    api = accessGrantApi(app)
    groupId = await createGroup('Comp AI')
  })

  afterEach(async () => {
    await app.close()
  })

  it('keeps a group grant with its secrets and files', async () => {
    const id = savedId(
      (
        await api
          .save({
            input: { scope: groupScope(groupId), name: 'npm', instruction: 'registry access' },
          })
          .expect(200)
      ).body,
    )
    await api
      .groupCall({
        procedure: 'setSecret',
        input: { groupId, name: 'NPM_TOKEN', value: 'v', grantId: id },
      })
      .expect(200)
    await api
      .groupCall({
        procedure: 'setFileMount',
        input: { groupId, path: '~/.npmrc', contents: 'r', grantId: id },
      })
      .expect(200)

    const grants = await api.list({ scope: groupScope(groupId) })
    expect(grants).toHaveLength(1)
    expect(grants[0]).toMatchObject({ name: 'npm', instruction: 'registry access' })
    expect(grants[0]?.secrets.map((secret) => secret.name)).toEqual(['NPM_TOKEN'])
    expect(grants[0]?.files).toMatchObject([{ path: '~/.npmrc', mode: 384 }])
    expect(
      await db.orm.public.GroupSecret.where({ groupId, name: 'NPM_TOKEN' }).first(),
    ).not.toBeNull()
  })

  it('answers 404 for a group of another user', async () => {
    const scope = groupScope(groupId)
    await trpcQuery({
      app,
      path: 'accessGrants.list',
      token: 'session-b',
      input: { scope },
    }).expect(404)
    await api
      .save({ token: 'session-b', input: { scope, name: 'theirs', instruction: '' } })
      .expect(404)
    await api.remove({ token: 'session-b', scope, id: 'gag_missing' }).expect(404)
    await api
      .groupCall({
        procedure: 'setSecret',
        token: 'session-b',
        input: { groupId, name: 'THEIRS', value: 'v' },
      })
      .expect(404)
  })

  it('layers personal, group and project and marks the overridden member', async () => {
    const projectId = await createProjectAs({ app, token: 'session-a' })
    await db.orm.public.Project.where({ id: projectId }).update({ groupId })
    await api.setSecret({ name: 'SHARED', value: 'personal' }).expect(200)
    await api
      .groupCall({ procedure: 'setSecret', input: { groupId, name: 'SHARED', value: 'group' } })
      .expect(200)
    await api
      .projectCall({
        procedure: 'setSecret',
        input: { projectId, name: 'PROJECT_ONLY', value: 'p' },
      })
      .expect(200)

    const layers = await api.layered({ scope: projectScope(projectId) })
    expect(layers.map((layer) => layer.layer)).toEqual(['personal', 'group', 'project'])
    expect(layers[0]?.owner).toEqual({ id: null, name: 'Personal' })
    expect(layers[1]?.owner?.name).toBe('Comp AI')
    expect(layers[1]?.owner?.id).toBe(groupId)
    expect(layers[2]?.owner?.id).toBe(projectId)
    expect(layers[0]?.grants[0]?.secrets[0]).toMatchObject({
      name: 'SHARED',
      overriddenBy: 'group',
    })
    expect(layers[1]?.grants[0]?.secrets[0]).toMatchObject({ name: 'SHARED', overriddenBy: null })
    expect(layers[2]?.grants[0]?.secrets[0]).toMatchObject({
      name: 'PROJECT_ONLY',
      overriddenBy: null,
    })
  })

  it('stops a group layered read at the group layer', async () => {
    await api.setSecret({ name: 'ONLY_ME', value: 'x' }).expect(200)
    await api
      .groupCall({ procedure: 'setSecret', input: { groupId, name: 'GROUP_KEY', value: 'g' } })
      .expect(200)

    const layers = await api.layered({ scope: groupScope(groupId) })
    expect(layers.map((layer) => layer.layer)).toEqual(['personal', 'group'])
  })

  it('moves a group member between grants and deletes the emptied auto grant', async () => {
    await api
      .groupCall({ procedure: 'setSecret', input: { groupId, name: 'A_TOKEN', value: 'a' } })
      .expect(200)
    await api
      .groupCall({ procedure: 'setFileMount', input: { groupId, path: '~/.a', contents: 'a' } })
      .expect(200)
    const target = (await db.orm.public.GroupAccessGrant.where({ groupId, name: '~/.a' }).first())
      ?.id
    expect(target).toBeString()

    await api
      .moveMember({
        input: {
          scope: groupScope(groupId),
          grantId: target ?? '',
          member: { kind: 'secret', name: 'A_TOKEN' },
        },
      })
      .expect(200)

    const grants = await api.list({ scope: groupScope(groupId) })
    expect(grants).toHaveLength(1)
    expect(grants[0]?.secrets.map((secret) => secret.name)).toEqual(['A_TOKEN'])
    expect(
      await db.orm.public.GroupAccessGrant.where({ groupId, name: 'A_TOKEN' }).first(),
    ).toBeNull()
  })

  it('deletes the members of a removed group grant', async () => {
    const id = savedId(
      (
        await api
          .save({ input: { scope: groupScope(groupId), name: 'gone', instruction: 'gone' } })
          .expect(200)
      ).body,
    )
    await api
      .groupCall({
        procedure: 'setSecret',
        input: { groupId, name: 'GONE_SECRET', value: 'v', grantId: id },
      })
      .expect(200)

    await api.remove({ scope: groupScope(groupId), id }).expect(200)
    expect(await api.list({ scope: groupScope(groupId) })).toEqual([])
    expect(
      await db.orm.public.GroupSecret.where({ groupId, name: 'GONE_SECRET' }).first(),
    ).toBeNull()
  })
})
