import type { INestApplication, Provider } from '@nestjs/common'
import { GithubService } from '@dltech/atlas-github'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { ProjectGroup, ProjectGroupList } from '@dltech/atlas-wire'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { seedProject, seedSessionUsers } from '../../../test/web-settings.fake-db'
import { ProjectsService } from '../projects/projects.service'
import { buildSessionTrpcApp, dataOf, trpcMutation, trpcQuery } from '../session-trpc-test-app'
import { ProjectGroupsRouter } from './project-groups.router'
import { GroupsService } from './project-groups.service'

const providers: Provider[] = [
  GroupsService,
  ProjectGroupsRouter,
  ProjectsService,
  { provide: GithubService, useValue: { findToken: async () => undefined } },
]

describe('projectGroups router', () => {
  useTestDatabase()
  let app: INestApplication

  const mutation = (args: { path: string; token: string; input: object }) =>
    trpcMutation({ app, path: `projectGroups.${args.path}`, token: args.token, input: args.input })

  const save = (token: string, input: object) => mutation({ path: 'save', token, input })
  const remove = (token: string, id: string) => mutation({ path: 'remove', token, input: { id } })
  const assign = (token: string, input: { projectId: string; groupId: string | null }) =>
    mutation({ path: 'assign', token, input })

  const list = async (token = 'session-a'): Promise<ProjectGroupList> => {
    const listed = await trpcQuery({ app, path: 'projectGroups.list', token }).expect(200)
    return dataOf(listed.body) as ProjectGroupList
  }

  const createGroup = async (
    args: { token?: string; name?: string } = {},
  ): Promise<ProjectGroup> => {
    const created = await save(args.token ?? 'session-a', { name: args.name ?? 'Comp AI' }).expect(
      200,
    )
    return dataOf(created.body) as ProjectGroup
  }

  beforeEach(async () => {
    await seedSessionUsers()
    app = await buildSessionTrpcApp({ providers })
  })

  afterEach(() => app.close())

  it('creates, renames, lists and removes a group', async () => {
    const created = await createGroup({ name: '  Comp AI  ' })
    expect(created).toMatchObject({ name: 'Comp AI', projectIds: [] })

    const renamed = await save('session-a', { id: created.id, name: 'Comp AI Labs' }).expect(200)
    expect(dataOf(renamed.body)).toMatchObject({ id: created.id, name: 'Comp AI Labs' })

    expect(await list()).toEqual({ groups: [{ ...created, name: 'Comp AI Labs' }] })

    await remove('session-a', created.id).expect(200)
    expect(await list()).toEqual({ groups: [] })
  })

  it('assigns a project to a group, lists it on the group and unassigns it with null', async () => {
    await seedProject({ id: 'prj_1', ownerUserId: 'user-a' })
    const group = await createGroup()

    await assign('session-a', { projectId: 'prj_1', groupId: group.id }).expect(200)
    expect((await list()).groups[0]?.projectIds).toEqual(['prj_1'])
    expect((await db.orm.public.Project.first({ id: 'prj_1' }))?.groupId).toBe(group.id)

    await assign('session-a', { projectId: 'prj_1', groupId: null }).expect(200)
    expect((await list()).groups[0]?.projectIds).toEqual([])
    expect((await db.orm.public.Project.first({ id: 'prj_1' }))?.groupId).toBeNull()
  })

  it('ungroups the projects of a deleted group', async () => {
    await seedProject({ id: 'prj_1', ownerUserId: 'user-a' })
    const group = await createGroup()
    await assign('session-a', { projectId: 'prj_1', groupId: group.id }).expect(200)

    await remove('session-a', group.id).expect(200)

    expect((await db.orm.public.Project.first({ id: 'prj_1' }))?.groupId).toBeNull()
  })

  it('answers 409 for a name the same user already holds and lets another user reuse it', async () => {
    await createGroup({ name: 'Comp AI' })

    await save('session-a', { name: 'Comp AI' }).expect(409)
    await createGroup({ token: 'session-b', name: 'Comp AI' })
    expect((await list('session-b')).groups).toHaveLength(1)
  })

  it('keeps one user out of another user groups and projects', async () => {
    await seedProject({ id: 'prj_a', ownerUserId: 'user-a' })
    const other = await createGroup({ token: 'session-b', name: 'Theirs' })

    await save('session-a', { id: other.id, name: 'Mine' }).expect(404)
    await remove('session-a', other.id).expect(404)
    await assign('session-a', { projectId: 'prj_a', groupId: other.id }).expect(404)

    await seedProject({ id: 'prj_b', ownerUserId: 'user-b' })
    const mine = await createGroup()
    await assign('session-a', { projectId: 'prj_b', groupId: mine.id }).expect(404)
    expect((await db.orm.public.Project.first({ id: 'prj_b' }))?.groupId).toBeNull()
  })

  it('rejects an empty name and one longer than eighty characters with 400', async () => {
    await save('session-a', { name: '   ' }).expect(400)
    await save('session-a', { name: 'x'.repeat(81) }).expect(400)
    expect(await list()).toEqual({ groups: [] })
  })
})
