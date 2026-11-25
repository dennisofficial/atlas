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

describe('access grants router at project scope', () => {
  useTestDatabase()
  let app: INestApplication
  let api: ReturnType<typeof accessGrantApi>
  let projectId: string

  const projectSecret = (name: string) =>
    db.orm.public.ProjectSecret.where((row) => row.name.eq(name)).first()

  beforeEach(async () => {
    await seedSessionUsers()
    app = await buildAccessGrantsApp()
    api = accessGrantApi(app)
    projectId = await createProjectAs({ app, token: 'session-a' })
  })

  afterEach(async () => {
    await app.close()
  })

  it('round trips a project grant with secrets and file mounts', async () => {
    await api.projectCall({
      procedure: 'setSecret',
      input: { projectId, name: 'PROJ_TOKEN', value: 'v' },
    })
    await api.projectCall({
      procedure: 'setFileMount',
      input: { projectId, path: '~/.npmrc', contents: '//registry' },
    })

    const saved = await api
      .save({
        input: {
          scope: projectScope(projectId),
          name: 'npm',
          instruction: '',
          secretNames: ['PROJ_TOKEN'],
          filePaths: ['~/.npmrc'],
        },
      })
      .expect(200)
    const id = savedId(saved.body)
    expect(id.startsWith('pag_')).toBe(true)

    expect(await api.list({ scope: projectScope(projectId) })).toMatchObject([
      { id, name: 'npm', secretNames: ['PROJ_TOKEN'], filePaths: ['~/.npmrc'] },
    ])
    expect((await projectSecret('PROJ_TOKEN'))?.grantId).toBe(id)
  })

  it('renames a grant, moves a member out of another grant and ungroups it', async () => {
    for (const name of ['A_TOKEN', 'B_TOKEN']) {
      await api.projectCall({ procedure: 'setSecret', input: { projectId, name, value: 'v' } })
    }
    const scope = projectScope(projectId)
    const a = savedId(
      (
        await api
          .save({
            input: {
              scope,
              name: 'alpha',
              instruction: '',
              secretNames: ['A_TOKEN'],
              filePaths: [],
            },
          })
          .expect(200)
      ).body,
    )
    const b = savedId(
      (
        await api
          .save({
            input: {
              scope,
              name: 'beta',
              instruction: '',
              secretNames: ['B_TOKEN'],
              filePaths: [],
            },
          })
          .expect(200)
      ).body,
    )

    await api
      .save({
        input: {
          scope,
          id: a,
          name: 'alpha-renamed',
          instruction: 'all of it',
          secretNames: ['A_TOKEN', 'B_TOKEN'],
          filePaths: [],
        },
      })
      .expect(200)

    expect(await api.list({ scope })).toMatchObject([
      {
        id: a,
        name: 'alpha-renamed',
        instruction: 'all of it',
        secretNames: ['A_TOKEN', 'B_TOKEN'],
      },
      { id: b, name: 'beta', secretNames: [] },
    ])
    expect((await projectSecret('B_TOKEN'))?.grantId).toBe(a)

    await api
      .save({
        input: {
          scope,
          id: a,
          name: 'alpha-renamed',
          instruction: 'all of it',
          secretNames: ['A_TOKEN'],
          filePaths: [],
        },
      })
      .expect(200)
    expect((await projectSecret('B_TOKEN'))?.grantId).toBeNull()
  })

  it('rejects an unknown secret and an unknown file path', async () => {
    const scope = projectScope(projectId)
    await api
      .save({
        input: { scope, name: 'x', instruction: '', secretNames: ['MISSING'], filePaths: [] },
      })
      .expect(400)
    await api
      .save({
        input: { scope, name: 'x', instruction: '', secretNames: [], filePaths: ['missing.txt'] },
      })
      .expect(400)
    expect(await api.list({ scope })).toEqual([])
  })

  it('answers 409 for a duplicate name in one project', async () => {
    const body = {
      scope: projectScope(projectId),
      name: 'twice',
      instruction: '',
      secretNames: [],
      filePaths: [],
    }
    await api.save({ input: body }).expect(200)
    await api.save({ input: body }).expect(409)
  })

  it('hides another user’s project grants', async () => {
    const scope = projectScope(projectId)
    const id = savedId(
      (
        await api
          .save({
            input: { scope, name: 'mine', instruction: '', secretNames: [], filePaths: [] },
          })
          .expect(200)
      ).body,
    )

    await trpcQuery({
      app,
      path: 'accessGrants.list',
      token: 'session-b',
      input: { scope },
    }).expect(404)
    await api
      .save({
        token: 'session-b',
        input: { scope, name: 'theirs', instruction: '', secretNames: [], filePaths: [] },
      })
      .expect(404)
    await api.remove({ token: 'session-b', scope, id }).expect(404)
    expect(await api.list({ scope })).toHaveLength(1)
  })

  it('drops a deleted secret from the grant and keeps the grant of a re-set secret', async () => {
    for (const name of ['DROP', 'ROTATE']) {
      await api.projectCall({ procedure: 'setSecret', input: { projectId, name, value: 'one' } })
    }
    const scope = projectScope(projectId)
    await api
      .save({
        input: {
          scope,
          name: 'both',
          instruction: '',
          secretNames: ['DROP', 'ROTATE'],
          filePaths: [],
        },
      })
      .expect(200)

    await api.projectCall({
      procedure: 'setSecret',
      input: { projectId, name: 'ROTATE', value: 'two' },
    })
    expect((await api.list({ scope }))[0]?.secretNames).toEqual(['DROP', 'ROTATE'])

    await api.projectCall({ procedure: 'removeSecret', input: { projectId, name: 'DROP' } })
    expect((await api.list({ scope }))[0]?.secretNames).toEqual(['ROTATE'])
  })
})
