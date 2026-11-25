import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { INestApplication } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { seedSessionUsers } from '../../../test/web-settings.fake-db'
import { createProjectAs } from '../projects/projects.router.fixture'
import { trpcQuery } from '../session-trpc-test-app'
import {
  accessGrantApi,
  buildAccessGrantsApp,
  projectScope,
  savedId,
} from './access-grants.router.fixture'

const OTHER_PROJECT = {
  name: 'other',
  repo: 'dennisofficial/other',
  baseBranch: 'main',
  additionalRepos: [],
}

describe('access grants router at project scope', () => {
  useTestDatabase()
  let app: INestApplication
  let api: ReturnType<typeof accessGrantApi>
  let projectId: string

  const projectSecret = (name: string) =>
    db.orm.public.ProjectSecret.where((row) => row.name.eq(name)).first()
  const projectGrant = (name: string) =>
    db.orm.public.ProjectAccessGrant.where((row) => row.name.eq(name)).first()

  beforeEach(async () => {
    await seedSessionUsers()
    app = await buildAccessGrantsApp()
    api = accessGrantApi(app)
    projectId = await createProjectAs({ app, token: 'session-a' })
  })

  afterEach(async () => {
    await app.close()
  })

  it('gives a new secret and a new file mount a grant of their own', async () => {
    await api
      .projectCall({
        procedure: 'setSecret',
        input: { projectId, name: 'PROJ_TOKEN', value: 'v' },
      })
      .expect(200)
    await api
      .projectCall({
        procedure: 'setFileMount',
        input: { projectId, path: '~/.npmrc', contents: '//registry' },
      })
      .expect(200)

    const grants = await api.list({ scope: projectScope(projectId) })
    expect(grants.map((grant) => grant.name)).toEqual(['PROJ_TOKEN', '~/.npmrc'])
    const tokenGrant = grants[0]
    expect(tokenGrant?.secrets.map((secret) => secret.name)).toEqual(['PROJ_TOKEN'])
    const fileGrant = grants[1]
    expect(fileGrant?.files).toMatchObject([{ path: '~/.npmrc', mode: 384 }])
    expect(typeof fileGrant?.files[0]?.updatedAt).toBe('string')
    expect((await projectSecret('PROJ_TOKEN'))?.grantId).toBe(tokenGrant?.id)
  })

  it('keeps a chosen grant on a plain re-set and moves it when asked', async () => {
    const id = savedId(
      (
        await api
          .save({ input: { scope: projectScope(projectId), name: 'npm', instruction: '' } })
          .expect(200)
      ).body,
    )
    await api
      .projectCall({
        procedure: 'setSecret',
        input: { projectId, name: 'NPM_TOKEN', value: 'one', grantId: id },
      })
      .expect(200)
    await api
      .projectCall({
        procedure: 'setSecret',
        input: { projectId, name: 'NPM_TOKEN', value: 'two' },
      })
      .expect(200)
    expect((await api.list({ scope: projectScope(projectId) }))[0]?.secrets).toMatchObject([
      { name: 'NPM_TOKEN' },
    ])

    const other = savedId(
      (
        await api
          .save({ input: { scope: projectScope(projectId), name: 'other', instruction: '' } })
          .expect(200)
      ).body,
    )
    await api
      .projectCall({
        procedure: 'setSecret',
        input: { projectId, name: 'NPM_TOKEN', value: 'two', grantId: other },
      })
      .expect(200)
    const grants = await api.list({ scope: projectScope(projectId) })
    expect(grants.map((grant) => grant.name)).toEqual(['other'])
    expect(grants[0]?.secrets.map((secret) => secret.name)).toEqual(['NPM_TOKEN'])
  })

  it('answers 404 for a grant of another project or another user', async () => {
    const otherProjectId = await createProjectAs({
      app,
      token: 'session-a',
      body: OTHER_PROJECT,
    })
    const elsewhere = savedId(
      (
        await api
          .save({
            input: { scope: projectScope(otherProjectId), name: 'elsewhere', instruction: '' },
          })
          .expect(200)
      ).body,
    )
    await api
      .projectCall({
        procedure: 'setSecret',
        input: { projectId, name: 'MISPLACED', value: 'v', grantId: elsewhere },
      })
      .expect(404)

    const mine = savedId(
      (
        await api
          .save({ input: { scope: projectScope(projectId), name: 'mine', instruction: '' } })
          .expect(200)
      ).body,
    )
    await api
      .projectCall({
        procedure: 'setSecret',
        input: { projectId, name: 'THEIRS', value: 'v', grantId: mine },
        token: 'session-b',
      })
      .expect(404)
  })

  it('deletes the members of a removed grant', async () => {
    const id = savedId(
      (
        await api
          .save({ input: { scope: projectScope(projectId), name: 'gone', instruction: 'gone' } })
          .expect(200)
      ).body,
    )
    await api
      .projectCall({
        procedure: 'setSecret',
        input: { projectId, name: 'GONE_SECRET', value: 'v', grantId: id },
      })
      .expect(200)
    await api
      .projectCall({
        procedure: 'setFileMount',
        input: { projectId, path: '~/.gone', contents: 'v', grantId: id },
      })
      .expect(200)

    await api.remove({ scope: projectScope(projectId), id }).expect(200)
    expect(await api.list({ scope: projectScope(projectId) })).toEqual([])
    expect(await projectSecret('GONE_SECRET')).toBeNull()
    expect(
      await db.orm.public.ProjectFileMount.where({ projectId, path: '~/.gone' }).first(),
    ).toBeNull()
  })

  it('deletes an emptied auto grant but keeps a described one', async () => {
    await api
      .projectCall({
        procedure: 'setSecret',
        input: { projectId, name: 'AUTO', value: 'v' },
      })
      .expect(200)
    const described = savedId(
      (
        await api
          .save({
            input: { scope: projectScope(projectId), name: 'described', instruction: 'keep me' },
          })
          .expect(200)
      ).body,
    )
    await api
      .projectCall({
        procedure: 'setSecret',
        input: { projectId, name: 'KEPT', value: 'v', grantId: described },
      })
      .expect(200)

    await api.projectCall({ procedure: 'removeSecret', input: { projectId, name: 'AUTO' } })
    expect(await projectGrant('AUTO')).toBeNull()

    await api.projectCall({ procedure: 'removeSecret', input: { projectId, name: 'KEPT' } })
    expect(await projectGrant('described')).not.toBeNull()
  })

  it('moves a secret and a file mount between grants', async () => {
    await api.projectCall({
      procedure: 'setSecret',
      input: { projectId, name: 'A_TOKEN', value: 'a' },
    })
    await api.projectCall({
      procedure: 'setFileMount',
      input: { projectId, path: '~/.a', contents: 'a' },
    })
    const target = (await projectGrant('~/.a'))?.id ?? ''
    const scope = projectScope(projectId)

    await api
      .moveMember({
        input: { scope, grantId: target, member: { kind: 'secret', name: 'A_TOKEN' } },
      })
      .expect(200)
    await api
      .moveMember({
        input: { scope, grantId: target, member: { kind: 'file', path: '~/.missing' } },
      })
      .expect(404)
    await api
      .moveMember({
        input: { scope, grantId: 'pag_missing', member: { kind: 'file', path: '~/.a' } },
      })
      .expect(404)

    const grants = await api.list({ scope })
    expect(grants).toHaveLength(1)
    expect(grants[0]?.secrets.map((secret) => secret.name)).toEqual(['A_TOKEN'])
    expect(grants[0]?.files.map((file) => file.path)).toEqual(['~/.a'])
    expect(await projectGrant('A_TOKEN')).toBeNull()
  })

  it('renames a grant, answers 409 on a duplicate and hides it from another user', async () => {
    const scope = projectScope(projectId)
    const id = savedId(
      (await api.save({ input: { scope, name: 'first', instruction: '' } }).expect(200)).body,
    )
    await api.save({ input: { scope, id, name: 'renamed', instruction: 'note' } }).expect(200)
    expect((await api.list({ scope }))[0]).toMatchObject({ name: 'renamed', instruction: 'note' })

    await api.save({ input: { scope, name: 'renamed', instruction: '' } }).expect(409)
    await trpcQuery({
      app,
      path: 'accessGrants.list',
      token: 'session-b',
      input: { scope },
    }).expect(404)
    await api
      .save({ token: 'session-b', input: { scope, name: 'theirs', instruction: '' } })
      .expect(404)
    await api.remove({ token: 'session-b', scope, id }).expect(404)
  })
})
