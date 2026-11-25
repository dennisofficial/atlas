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
  const grantNamed = async (name: string) =>
    db.orm.public.UserAccessGrant.where((row) => row.name.eq(name)).first()

  beforeEach(async () => {
    await seedSessionUsers()
    app = await buildAccessGrantsApp()
    api = accessGrantApi(app)
  })

  afterEach(async () => {
    await app.close()
  })

  it('gives a new secret a grant of its own named after it', async () => {
    await api.setSecret({ name: 'API_TOKEN', value: 'v1' }).expect(200)

    const grants = await api.list({ scope: PERSONAL })
    expect(grants).toHaveLength(1)
    expect(grants[0]).toMatchObject({
      name: 'API_TOKEN',
      instruction: '',
      secrets: [{ name: 'API_TOKEN' }],
      files: [],
    })
    expect(typeof grants[0]?.updatedAt).toBe('string')
    expect(Object.keys(grants[0] ?? {}).sort()).toEqual([
      'files',
      'id',
      'instruction',
      'name',
      'secrets',
      'updatedAt',
    ])
    expect((await userSecret('API_TOKEN'))?.grantId).toBe(grants[0]?.id)
  })

  it('suffixes the grant name when it is taken', async () => {
    await api
      .save({ input: { scope: PERSONAL, name: 'API_TOKEN', instruction: 'mine' } })
      .expect(200)
    await api.setSecret({ name: 'API_TOKEN', value: 'v1' }).expect(200)

    expect((await api.list({ scope: PERSONAL })).map((grant) => grant.name)).toEqual([
      'API_TOKEN',
      'API_TOKEN 2',
    ])
  })

  it('puts a secret in a chosen grant and keeps it there on a plain re-set', async () => {
    const id = savedId(
      (
        await api
          .save({ input: { scope: PERSONAL, name: 'deploy', instruction: 'deploy it' } })
          .expect(200)
      ).body,
    )
    await api.setSecret({ name: 'DEPLOY_KEY', value: 'one', grantId: id }).expect(200)

    await api.setSecret({ name: 'DEPLOY_KEY', value: 'two' }).expect(200)
    expect((await api.list({ scope: PERSONAL }))[0]?.secrets).toMatchObject([
      { name: 'DEPLOY_KEY' },
    ])
  })

  it('moves a re-set secret and deletes the auto grant it emptied', async () => {
    await api.setSecret({ name: 'A_TOKEN', value: 'a' }).expect(200)
    const target = savedId(
      (await api.save({ input: { scope: PERSONAL, name: 'target', instruction: '' } }).expect(200))
        .body,
    )

    await api.setSecret({ name: 'A_TOKEN', value: 'a', grantId: target }).expect(200)
    const grants = await api.list({ scope: PERSONAL })
    expect(grants).toHaveLength(1)
    expect(grants[0]).toMatchObject({ id: target, secrets: [{ name: 'A_TOKEN' }] })
  })

  it('answers 404 for a grant of another user', async () => {
    const id = savedId(
      (await api.save({ input: { scope: PERSONAL, name: 'mine', instruction: '' } }).expect(200))
        .body,
    )
    await api.setSecret({ token: 'session-b', name: 'THEIRS', value: 'v', grantId: id }).expect(404)
    expect(await api.list({ scope: PERSONAL, token: 'session-b' })).toEqual([])
  })

  it('deletes the members of a removed grant', async () => {
    const id = savedId(
      (
        await api
          .save({ input: { scope: PERSONAL, name: 'gone', instruction: 'gone' } })
          .expect(200)
      ).body,
    )
    await api.setSecret({ name: 'GONE', value: 'v', grantId: id }).expect(200)

    await api.remove({ scope: PERSONAL, id }).expect(200)
    expect(await api.list({ scope: PERSONAL })).toEqual([])
    expect(await userSecret('GONE')).toBeNull()
  })

  it('deletes an emptied auto grant but keeps a described one', async () => {
    await api.setSecret({ name: 'AUTO', value: 'v' }).expect(200)
    const described = savedId(
      (
        await api
          .save({ input: { scope: PERSONAL, name: 'described', instruction: 'keep me' } })
          .expect(200)
      ).body,
    )
    await api.setSecret({ name: 'KEPT', value: 'v', grantId: described }).expect(200)

    await api.removeSecret({ name: 'AUTO' }).expect(200)
    expect(await grantNamed('AUTO')).toBeNull()

    await api.removeSecret({ name: 'KEPT' }).expect(200)
    expect(await grantNamed('described')).not.toBeNull()
    expect((await api.list({ scope: PERSONAL }))[0]).toMatchObject({
      name: 'described',
      secrets: [],
    })
  })

  it('moves one member to another grant and cleans the source', async () => {
    await api.setSecret({ name: 'A_TOKEN', value: 'a' }).expect(200)
    await api.setSecret({ name: 'B_TOKEN', value: 'b' }).expect(200)
    const target = (await grantNamed('B_TOKEN'))?.id ?? ''

    await api
      .moveMember({
        input: { scope: PERSONAL, grantId: target, member: { kind: 'secret', name: 'A_TOKEN' } },
      })
      .expect(200)

    const grants = await api.list({ scope: PERSONAL })
    expect(grants).toHaveLength(1)
    expect(grants[0]?.secrets.map((secret) => secret.name)).toEqual(['A_TOKEN', 'B_TOKEN'])
    expect(await grantNamed('A_TOKEN')).toBeNull()
  })

  it('answers 404 for an unknown member or grant on move', async () => {
    await api.setSecret({ name: 'A_TOKEN', value: 'a' }).expect(200)
    const target = (await grantNamed('A_TOKEN'))?.id ?? ''

    await api
      .moveMember({
        input: { scope: PERSONAL, grantId: target, member: { kind: 'secret', name: 'MISSING' } },
      })
      .expect(404)
    await api
      .moveMember({
        input: {
          scope: PERSONAL,
          grantId: 'uag_missing',
          member: { kind: 'secret', name: 'A_TOKEN' },
        },
      })
      .expect(404)
    await api
      .moveMember({
        token: 'session-b',
        input: { scope: PERSONAL, grantId: target, member: { kind: 'secret', name: 'A_TOKEN' } },
      })
      .expect(404)
  })

  it('renames a grant and answers 409 for a duplicate name', async () => {
    const id = savedId(
      (await api.save({ input: { scope: PERSONAL, name: 'first', instruction: '' } }).expect(200))
        .body,
    )
    await api
      .save({ input: { scope: PERSONAL, id, name: 'renamed', instruction: 'note' } })
      .expect(200)
    expect((await api.list({ scope: PERSONAL }))[0]).toMatchObject({
      name: 'renamed',
      instruction: 'note',
    })

    await api.save({ input: { scope: PERSONAL, name: 'renamed', instruction: '' } }).expect(409)
    await api
      .save({ token: 'session-b', input: { scope: PERSONAL, id, name: 'stolen', instruction: '' } })
      .expect(404)
  })
})
