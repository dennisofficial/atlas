import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { INestApplication } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { seedSessionUsers } from '../../../test/web-settings.fake-db'
import {
  accessGrantApi,
  buildAccessGrantsApp,
  PERSONAL,
  savedId,
} from './access-grants.router.fixture'

describe('access grants router at personal scope', () => {
  useTestDatabase()
  let app: INestApplication
  let api: ReturnType<typeof accessGrantApi>

  const userSecret = (name: string) =>
    db.orm.public.UserSecret.where((row) => row.name.eq(name)).first()

  beforeEach(async () => {
    await seedSessionUsers()
    app = await buildAccessGrantsApp()
    api = accessGrantApi(app)
  })

  afterEach(async () => {
    await app.close()
  })

  it('round trips a personal grant with its members', async () => {
    await api.setSecret({ name: 'API_TOKEN', value: 'v1' }).expect(200)
    await api.setSecret({ name: 'DB_URL', value: 'v2' }).expect(200)

    const saved = await api
      .save({
        input: {
          scope: PERSONAL,
          name: 'deploy',
          instruction: 'You can deploy with API_TOKEN.',
          secretNames: ['API_TOKEN'],
          filePaths: [],
        },
      })
      .expect(200)
    const id = savedId(saved.body)
    expect(id.startsWith('uag_')).toBe(true)

    const grants = await api.list({ scope: PERSONAL })
    expect(grants).toHaveLength(1)
    expect(grants[0]).toMatchObject({
      id,
      name: 'deploy',
      instruction: 'You can deploy with API_TOKEN.',
      secretNames: ['API_TOKEN'],
      filePaths: [],
    })
    expect(typeof grants[0]?.updatedAt).toBe('string')
    expect(Object.keys(grants[0] ?? {}).sort()).toEqual([
      'filePaths',
      'id',
      'instruction',
      'name',
      'secretNames',
      'updatedAt',
    ])
    expect((await userSecret('API_TOKEN'))?.grantId).toBe(id)
  })

  it('keeps the secrets of a removed grant and ungroups them', async () => {
    await api.setSecret({ name: 'KEEP_ME', value: 'v' }).expect(200)
    const id = savedId(
      (
        await api
          .save({
            input: {
              scope: PERSONAL,
              name: 'gone',
              instruction: '',
              secretNames: ['KEEP_ME'],
              filePaths: [],
            },
          })
          .expect(200)
      ).body,
    )

    await api.remove({ scope: PERSONAL, id }).expect(200)
    expect(await api.list({ scope: PERSONAL })).toEqual([])
    expect((await userSecret('KEEP_ME'))?.grantId).toBeNull()
  })

  it('rejects an unknown member and a personal file path', async () => {
    await api
      .save({
        input: {
          scope: PERSONAL,
          name: 'x',
          instruction: '',
          secretNames: ['MISSING'],
          filePaths: [],
        },
      })
      .expect(400)
    await api
      .save({
        input: {
          scope: PERSONAL,
          name: 'x',
          instruction: '',
          secretNames: [],
          filePaths: ['a.txt'],
        },
      })
      .expect(400)
    expect(await api.list({ scope: PERSONAL })).toEqual([])
  })

  it('answers 409 for a duplicate name in personal scope', async () => {
    const body = { scope: PERSONAL, name: 'twice', instruction: '', secretNames: [], filePaths: [] }
    await api.save({ input: body }).expect(200)
    await api.save({ input: body }).expect(409)
  })

  it('hides another user’s personal grants', async () => {
    const id = savedId(
      (
        await api
          .save({
            input: {
              scope: PERSONAL,
              name: 'mine',
              instruction: '',
              secretNames: [],
              filePaths: [],
            },
          })
          .expect(200)
      ).body,
    )

    await api.remove({ token: 'session-b', scope: PERSONAL, id }).expect(404)
    await api
      .save({
        token: 'session-b',
        input: {
          scope: PERSONAL,
          id,
          name: 'stolen',
          instruction: '',
          secretNames: [],
          filePaths: [],
        },
      })
      .expect(404)
    expect(await api.list({ scope: PERSONAL, token: 'session-b' })).toEqual([])
    expect(await api.list({ scope: PERSONAL })).toHaveLength(1)
  })

  it('keeps the grant of a re-set personal secret', async () => {
    await api.setSecret({ name: 'ROTATE', value: 'one' }).expect(200)
    await api
      .save({
        input: {
          scope: PERSONAL,
          name: 'rotated',
          instruction: '',
          secretNames: ['ROTATE'],
          filePaths: [],
        },
      })
      .expect(200)

    await api.setSecret({ name: 'ROTATE', value: 'two' }).expect(200)
    expect((await api.list({ scope: PERSONAL }))[0]?.secretNames).toEqual(['ROTATE'])
  })
})
