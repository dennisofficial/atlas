import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { encodeSettingValue } from '@dltech/atlas-wire/web'
import type { INestApplication } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { seedSessionUsers } from '../../../test/web-settings.fake-db'
import { createProjectAs } from '../projects/projects.router.fixture'
import { dataOf } from '../session-trpc-test-app'
import {
  buildGroupResourcesApp,
  groupResourcesApi,
  savedId,
} from './group-resources.router.fixture'

type LayeredValue = { key: string; value: string; overriddenBy: string | null }

type LayeredLayer = {
  layer: string
  owner: { id: string | null; name: string } | null
  values: LayeredValue[]
}

describe('group resources router', () => {
  useTestDatabase()
  let app: INestApplication
  let api: ReturnType<typeof groupResourcesApi>
  let groupId: string

  const layered = async (args: {
    procedure: 'layeredSettings'
    input: object
  }): Promise<LayeredLayer[]> => {
    const response = await api.query({ procedure: args.procedure, input: args.input }).expect(200)
    return (dataOf(response.body) as { layers: LayeredLayer[] }).layers
  }

  beforeEach(async () => {
    await seedSessionUsers()
    app = await buildGroupResourcesApp()
    api = groupResourcesApi(app)
    groupId = savedId((await api.saveGroup({ name: 'Comp AI' }).expect(200)).body)
  })

  afterEach(async () => {
    await app.close()
  })

  it('sets, reveals and removes a group secret in its grant', async () => {
    await api
      .call({ procedure: 'setSecret', input: { groupId, name: 'GROUP_TOKEN', value: 'first' } })
      .expect(200)
    const revealed = await api
      .query({ procedure: 'revealSecret', input: { groupId, name: 'GROUP_TOKEN' } })
      .expect(200)
    expect(dataOf(revealed.body)).toEqual({ value: 'first' })

    const listed = await api.query({ procedure: 'listSecrets', input: { groupId } }).expect(200)
    expect(dataOf(listed.body)).toMatchObject({ secrets: [{ name: 'GROUP_TOKEN' }] })

    const grant = await db.orm.public.GroupAccessGrant.where({
      groupId,
      name: 'GROUP_TOKEN',
    }).first()
    expect(grant).not.toBeNull()

    await api
      .call({ procedure: 'removeSecret', input: { groupId, name: 'GROUP_TOKEN' } })
      .expect(200)
    expect(
      await db.orm.public.GroupAccessGrant.where({ groupId, name: 'GROUP_TOKEN' }).first(),
    ).not.toBeNull()
  })

  it('sets, reveals and removes a group file mount', async () => {
    await api
      .call({
        procedure: 'setFileMount',
        input: { groupId, path: '~/.grouprc', contents: 'contents', mode: 384 },
      })
      .expect(200)
    const revealed = await api
      .query({ procedure: 'revealFileMount', input: { groupId, path: '~/.grouprc' } })
      .expect(200)
    expect(dataOf(revealed.body)).toEqual({ contents: 'contents' })

    await api
      .call({ procedure: 'removeFileMount', input: { groupId, path: '~/.grouprc' } })
      .expect(200)
    const listed = await api.query({ procedure: 'listFileMounts', input: { groupId } }).expect(200)
    expect(dataOf(listed.body)).toEqual({ mounts: [] })
  })

  it('patches a harness setting and refuses a personal-only key', async () => {
    await api
      .call({
        procedure: 'patchSettings',
        input: { groupId, values: { 'model.effort': encodeSettingValue('high') } },
      })
      .expect(200)
    await api
      .call({
        procedure: 'patchSettings',
        input: { groupId, values: { 'sandbox.vercelProjectId': encodeSettingValue('prj_1') } },
      })
      .expect(400)

    const listed = await api.query({ procedure: 'listSettings', input: { groupId } }).expect(200)
    expect(dataOf(listed.body)).toMatchObject({
      settings: [{ key: 'model.effort', value: encodeSettingValue('high') }],
    })

    await api
      .call({ procedure: 'patchSettings', input: { groupId, values: { 'model.effort': null } } })
      .expect(200)
    expect(await db.orm.public.GroupSetting.where({ groupId }).first()).toBeNull()
  })

  it('layers personal and group settings and marks the overridden value', async () => {
    await db.orm.public.UserSetting.create({
      id: 'set_personal_effort',
      userId: 'user-a',
      key: 'model.effort',
      value: encodeSettingValue('high'),
    })
    await api
      .call({
        procedure: 'patchSettings',
        input: {
          groupId,
          values: {
            'model.effort': encodeSettingValue('low'),
            'model.fast': encodeSettingValue(true),
          },
        },
      })
      .expect(200)

    const layers = await layered({ procedure: 'layeredSettings', input: { groupId } })
    expect(layers.map((layer) => layer.layer)).toEqual(['personal', 'group'])
    expect(layers[0]?.owner).toEqual({ id: null, name: 'Personal' })
    expect(layers[0]?.values).toMatchObject([{ key: 'model.effort', overriddenBy: 'group' }])
    expect(layers[1]?.owner).toEqual({ id: groupId, name: 'Comp AI' })
    expect(layers[1]?.values).toMatchObject([
      { key: 'model.effort', overriddenBy: null },
      { key: 'model.fast', overriddenBy: null },
    ])
  })

  it('layers personal, group and project settings in order', async () => {
    const projectId = await createProjectAs({ app, token: 'session-a' })
    await db.orm.public.Project.where({ id: projectId }).update({ groupId })
    await db.orm.public.UserSetting.create({
      id: 'set_personal_effort',
      userId: 'user-a',
      key: 'model.effort',
      value: encodeSettingValue('high'),
    })
    await api
      .call({
        procedure: 'patchSettings',
        input: { groupId, values: { 'model.effort': encodeSettingValue('low') } },
      })
      .expect(200)
    await api
      .projectCall({
        procedure: 'patchSettings',
        input: { projectId, values: { 'model.fast': encodeSettingValue(true) } },
      })
      .expect(200)

    const layers = await api
      .projectQuery({ procedure: 'layeredSettings', input: { projectId } })
      .expect(200)
    const body = dataOf(layers.body) as { layers: LayeredLayer[] }
    expect(body.layers.map((layer) => layer.layer)).toEqual(['personal', 'group', 'project'])
    expect(body.layers[0]?.values).toMatchObject([{ key: 'model.effort', overriddenBy: 'group' }])
    expect(body.layers[1]?.values).toMatchObject([{ key: 'model.effort', overriddenBy: null }])
    expect(body.layers[2]?.owner?.id).toBe(projectId)
    expect(body.layers[2]?.values).toMatchObject([{ key: 'model.fast', overriddenBy: null }])
  })

  it('answers 404 for a group of another user', async () => {
    await api
      .query({ procedure: 'listSettings', input: { groupId }, token: 'session-b' })
      .expect(404)
    await api
      .call({
        procedure: 'setSecret',
        token: 'session-b',
        input: { groupId, name: 'THEIRS', value: 'v' },
      })
      .expect(404)
    await api
      .query({ procedure: 'layeredSettings', input: { groupId }, token: 'session-b' })
      .expect(404)
  })
})
