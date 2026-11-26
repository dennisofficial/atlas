import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { INestApplication } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { seedSessionUsers } from '../../../test/web-settings.fake-db'
import { createProjectAs } from '../projects/projects.router.fixture'
import { trpcQuery, trpcMutation, dataOf } from '../session-trpc-test-app'
import {
  accessGrantApi,
  buildAccessGrantsApp,
  groupScope,
  PERSONAL,
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

  it('moves a group member between grants and keeps the emptied auto grant', async () => {
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
    expect(grants.map((grant) => grant.name)).toEqual(['A_TOKEN', '~/.a'])
    expect(grants[0]?.secrets).toEqual([])
    expect(grants[1]?.secrets.map((secret) => secret.name)).toEqual(['A_TOKEN'])
    expect(
      await db.orm.public.GroupAccessGrant.where({ groupId, name: 'A_TOKEN' }).first(),
    ).not.toBeNull()
  })

  it('keeps a group grant whose last member is deleted', async () => {
    const id = savedId(
      (
        await api
          .save({ input: { scope: groupScope(groupId), name: 'auto', instruction: '' } })
          .expect(200)
      ).body,
    )
    await api
      .groupCall({
        procedure: 'setSecret',
        input: { groupId, name: 'LAST_SECRET', value: 'v', grantId: id },
      })
      .expect(200)

    await api.groupCall({ procedure: 'removeSecret', input: { groupId, name: 'LAST_SECRET' } })

    const grants = await api.list({ scope: groupScope(groupId) })
    expect(grants).toHaveLength(1)
    expect(grants[0]).toMatchObject({ id, name: 'auto', secrets: [], files: [] })
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

  describe('moving a whole grant between layers', () => {
    const personalGrantNamed = (name: string) =>
      db.orm.public.UserAccessGrant.where({ name }).first()
    const groupGrantNamed = (name: string) =>
      db.orm.public.GroupAccessGrant.where({ groupId, name }).first()

    it('moves a personal grant with its secrets and files into a project', async () => {
      const projectId = await createProjectAs({ app, token: 'session-a' })
      await api.setSecret({ name: 'MOVE_ME', value: 'secret-value' }).expect(200)
      const sourceId = (await personalGrantNamed('MOVE_ME'))?.id ?? ''
      await api
        .personalMount({
          procedure: 'set',
          input: { path: '~/moved', contents: 'file-value', grantId: sourceId },
        })
        .expect(200)

      const moved = await api
        .moveGrant({ input: { scope: PERSONAL, id: sourceId, target: projectScope(projectId) } })
        .expect(200)
      const movedId = (dataOf(moved.body) as { id: string }).id

      expect(await personalGrantNamed('MOVE_ME')).toBeNull()
      expect(await db.orm.public.UserSecret.where({ name: 'MOVE_ME' }).first()).toBeNull()
      expect((await api.list({ scope: projectScope(projectId) }))[0]).toMatchObject({
        id: movedId,
        name: 'MOVE_ME',
        secrets: [{ name: 'MOVE_ME' }],
        files: [{ path: '~/moved', mode: 384 }],
      })
      const secret = await api
        .projectQuery({ procedure: 'revealSecret', input: { projectId, name: 'MOVE_ME' } })
        .expect(200)
      expect(dataOf(secret.body)).toEqual({ value: 'secret-value' })
      const file = await api
        .projectQuery({ procedure: 'revealFileMount', input: { projectId, path: '~/moved' } })
        .expect(200)
      expect(dataOf(file.body)).toEqual({ contents: 'file-value' })
    })

    it('moves a project grant into a group', async () => {
      const projectId = await createProjectAs({ app, token: 'session-a' })
      await api
        .projectCall({
          procedure: 'setSecret',
          input: { projectId, name: 'GROUP_BOUND', value: 'project-value' },
        })
        .expect(200)
      const source = await db.orm.public.ProjectAccessGrant.where({
        projectId,
        name: 'GROUP_BOUND',
      }).first()

      await api
        .moveGrant({
          input: {
            scope: projectScope(projectId),
            id: source?.id ?? '',
            target: groupScope(groupId),
          },
        })
        .expect(200)

      expect(
        await db.orm.public.ProjectAccessGrant.where({ projectId, name: 'GROUP_BOUND' }).first(),
      ).toBeNull()
      expect((await api.list({ scope: groupScope(groupId) }))[0]).toMatchObject({
        name: 'GROUP_BOUND',
        secrets: [{ name: 'GROUP_BOUND' }],
      })
      const revealed = await api
        .groupQuery({ procedure: 'revealSecret', input: { groupId, name: 'GROUP_BOUND' } })
        .expect(200)
      expect(dataOf(revealed.body)).toEqual({ value: 'project-value' })
    })

    it('moves a group grant into personal', async () => {
      await api
        .groupCall({
          procedure: 'setSecret',
          input: { groupId, name: 'MY_TOKEN', value: 'g-value' },
        })
        .expect(200)
      const source = await groupGrantNamed('MY_TOKEN')
      await api
        .groupCall({
          procedure: 'setFileMount',
          input: { groupId, path: '~/.npmrc', contents: 'registry', grantId: source?.id },
        })
        .expect(200)

      await api
        .moveGrant({
          input: { scope: groupScope(groupId), id: source?.id ?? '', target: PERSONAL },
        })
        .expect(200)

      expect(await groupGrantNamed('MY_TOKEN')).toBeNull()
      expect((await api.list({ scope: PERSONAL }))[0]).toMatchObject({
        name: 'MY_TOKEN',
        secrets: [{ name: 'MY_TOKEN' }],
        files: [{ path: '~/.npmrc' }],
      })
      const revealed = await trpcQuery({
        app,
        path: 'secrets.reveal',
        token: 'session-a',
        input: { name: 'MY_TOKEN' },
      }).expect(200)
      expect(dataOf(revealed.body)).toEqual({ value: 'g-value' })
      const file = await api
        .personalMountQuery({ procedure: 'reveal', input: { path: '~/.npmrc' } })
        .expect(200)
      expect(dataOf(file.body)).toEqual({ contents: 'registry' })
    })

    it('refuses a move to the layer the grant is already in', async () => {
      await api.setSecret({ name: 'STAY', value: 'v' }).expect(200)
      const id = (await personalGrantNamed('STAY'))?.id ?? ''

      await api.moveGrant({ input: { scope: PERSONAL, id, target: PERSONAL } }).expect(400)
      expect(await personalGrantNamed('STAY')).not.toBeNull()
    })

    it('refuses a target that already has a grant with that name', async () => {
      const projectId = await createProjectAs({ app, token: 'session-a' })
      await api
        .save({ input: { scope: projectScope(projectId), name: 'shared', instruction: '' } })
        .expect(200)
      await api.save({ input: { scope: PERSONAL, name: 'shared', instruction: '' } }).expect(200)
      const id = (await personalGrantNamed('shared'))?.id ?? ''

      const refused = await api
        .moveGrant({ input: { scope: PERSONAL, id, target: projectScope(projectId) } })
        .expect(409)
      expect(refused.text).toContain('a grant with that name already exists there')
      expect(await personalGrantNamed('shared')).not.toBeNull()
    })

    it('refuses a member clash and leaves both layers untouched', async () => {
      const projectId = await createProjectAs({ app, token: 'session-a' })
      await api
        .projectCall({
          procedure: 'setSecret',
          input: { projectId, name: 'CLASH', value: 'theirs' },
        })
        .expect(200)
      const id = savedId(
        (await api.save({ input: { scope: PERSONAL, name: 'mine', instruction: '' } }).expect(200))
          .body,
      )
      await api.setSecret({ name: 'CLASH', value: 'mine', grantId: id }).expect(200)

      const refused = await api
        .moveGrant({ input: { scope: PERSONAL, id, target: projectScope(projectId) } })
        .expect(409)
      expect(refused.text).toContain('CLASH')
      expect((await api.list({ scope: PERSONAL }))[0]).toMatchObject({
        id,
        secrets: [{ name: 'CLASH' }],
      })
      expect(await db.orm.public.ProjectAccessGrant.where({ projectId }).all()).toHaveLength(1)
      expect(
        (await db.orm.public.ProjectSecret.where({ projectId, name: 'CLASH' }).first())?.grantId,
      ).not.toBe(id)
    })

    it('refuses a repository path for a personal target', async () => {
      const projectId = await createProjectAs({ app, token: 'session-a' })
      await api
        .projectCall({
          procedure: 'setFileMount',
          input: { projectId, path: 'apps/api/.env', contents: 'v' },
        })
        .expect(200)
      const source = await db.orm.public.ProjectAccessGrant.where({
        projectId,
        name: 'apps/api/.env',
      }).first()

      const refused = await api
        .moveGrant({
          input: { scope: projectScope(projectId), id: source?.id ?? '', target: PERSONAL },
        })
        .expect(400)
      expect(refused.text).toContain('apps/api/.env')
      expect(
        await db.orm.public.ProjectAccessGrant.where({ projectId, name: 'apps/api/.env' }).first(),
      ).not.toBeNull()
    })

    it("refuses another user's project as the target", async () => {
      const projectId = await createProjectAs({ app, token: 'session-a' })
      await api.setSecret({ token: 'session-b', name: 'MINE', value: 'v' }).expect(200)
      const id = (await db.orm.public.UserAccessGrant.where({ name: 'MINE' }).first())?.id

      await api
        .moveGrant({
          token: 'session-b',
          input: { scope: PERSONAL, id: id ?? '', target: projectScope(projectId) },
        })
        .expect(404)
      expect(await personalGrantNamed('MINE')).not.toBeNull()
    })
  })
})
