import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { INestApplication } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { seedSessionUsers } from '../../../test/web-settings.fake-db'
import { STALE_PREFIX } from '../session-trpc-test-app'
import {
  accessGrantApi,
  buildAccessGrantsApp,
  PERSONAL,
  savedId,
} from '../access-grants/access-grants.router.fixture'

describe('personal file mounts router', () => {
  useTestDatabase()
  let app: INestApplication
  let api: ReturnType<typeof accessGrantApi>

  const mount = (path: string) =>
    db.orm.public.UserFileMount.where((row) => row.path.eq(path)).first()
  const grants = async () => (await api.list({ scope: PERSONAL })).map((grant) => grant.name)

  beforeEach(async () => {
    await seedSessionUsers()
    app = await buildAccessGrantsApp()
    api = accessGrantApi(app)
  })

  afterEach(async () => {
    await app.close()
  })

  it('round trips a mount with its contents sealed', async () => {
    await api
      .personalMount({
        procedure: 'set',
        input: { path: '~/.config/gh/hosts.yml', contents: 'oauth_token: secret' },
      })
      .expect(200)

    const listed = await api.personalMountQuery({ procedure: 'list' }).expect(200)
    expect(listed.text).not.toContain('secret')
    expect(listed.body.result.data.mounts).toMatchObject([
      { path: '~/.config/gh/hosts.yml', mode: 384 },
    ])

    const revealed = await api
      .personalMountQuery({
        procedure: 'reveal',
        input: { path: '~/.config/gh/hosts.yml' },
      })
      .expect(200)
    expect(revealed.body.result.data).toEqual({ contents: 'oauth_token: secret' })
    expect((await mount('~/.config/gh/hosts.yml'))?.sealedContents).not.toContain('secret')
  })

  it('refuses a path that does not start with ~/ or @/', async () => {
    for (const path of ['apps/api/.env', '/etc/passwd', '~/', '~/../escape'])
      await api.personalMount({ procedure: 'set', input: { path, contents: 'v' } }).expect(400)
    expect(await api.list({ scope: PERSONAL })).toEqual([])
  })

  it('requires a fresh session to reveal contents', async () => {
    await api
      .personalMount({ procedure: 'set', input: { path: '~/.npmrc', contents: 'token' } })
      .expect(200)
    const stale = await api
      .personalMountQuery({
        procedure: 'reveal',
        input: { path: '~/.npmrc' },
        token: `${STALE_PREFIX}session-a`,
      })
      .expect(403)
    expect(stale.text).toContain('REAUTH_REQUIRED')
    expect(stale.text).not.toContain('token')
  })

  it('gives a mount a grant of its own and keeps the grant when the mount goes', async () => {
    await api
      .personalMount({ procedure: 'set', input: { path: '~/allowed-users', contents: 'v' } })
      .expect(200)
    const grantId = (await mount('~/allowed-users'))?.grantId ?? ''

    await api.personalMount({ procedure: 'remove', input: { path: '~/allowed-users' } }).expect(200)
    expect(await db.orm.public.UserAccessGrant.where({ id: grantId }).first()).not.toBeNull()
  })

  it('keeps a chosen grant on a plain re-set', async () => {
    const id = savedId(
      (
        await api
          .save({ input: { scope: PERSONAL, name: 'gh', instruction: 'gh is set up' } })
          .expect(200)
      ).body,
    )
    await api
      .personalMount({
        procedure: 'set',
        input: { path: '~/.config/gh/hosts.yml', contents: 'one', grantId: id },
      })
      .expect(200)
    await api
      .personalMount({
        procedure: 'set',
        input: { path: '~/.config/gh/hosts.yml', contents: 'two' },
      })
      .expect(200)

    expect(await grants()).toEqual(['gh'])
    expect((await api.list({ scope: PERSONAL }))[0]?.files.map((file) => file.path)).toEqual([
      '~/.config/gh/hosts.yml',
    ])
  })

  it('hides another user’s mounts and answers 404 for their grant', async () => {
    const id = savedId(
      (await api.save({ input: { scope: PERSONAL, name: 'mine', instruction: '' } }).expect(200))
        .body,
    )
    await api
      .personalMount({
        procedure: 'set',
        input: { path: '~/mine', contents: 'v', grantId: id },
      })
      .expect(200)

    await api
      .personalMount({
        token: 'session-b',
        procedure: 'set',
        input: { path: '~/mine', contents: 'v', grantId: id },
      })
      .expect(404)
    const listed = await api
      .personalMountQuery({ procedure: 'list', token: 'session-b' })
      .expect(200)
    expect(listed.body.result.data.mounts).toEqual([])
    await api
      .personalMountQuery({ procedure: 'reveal', input: { path: '~/mine' }, token: 'session-b' })
      .expect(404)
  })
})
