import type { INestApplication } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { USER_VERCEL_CREDENTIAL_PATH, userVercelCredentialSchema } from '@dltech/atlas-wire/web'

import request from 'supertest'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { openSecretValue } from '../secrets/sealed-secret'
import { as, buildSessionApp } from '../session-test-app'
import { seedSessionUsers } from '../web-settings.fake-db'
import { UserVercelController } from './user-vercel.controller'
import { UserVercelService } from './user-vercel.service'

const credentialOf = (userId: string) => db.orm.public.UserVercelCredential.first({ userId })
const FULL = { token: 'vtok_secret', teamId: 'team_1', vercelProjectId: 'prj_1' }

describe('user vercel credential HTTP surface', () => {
  useTestDatabase()
  let app: INestApplication
  const http = () => request(app.getHttpServer())
  const put = (session: string, body: object) =>
    http().put(USER_VERCEL_CREDENTIAL_PATH).set(as(session)).send(body)
  const get = (session: string) => http().get(USER_VERCEL_CREDENTIAL_PATH).set(as(session))

  beforeEach(async () => {
    await seedSessionUsers()
    app = await buildSessionApp({
      controllers: [UserVercelController],
      providers: [UserVercelService],
    })
  })

  afterEach(() => app.close())

  it('requires a session', async () => {
    await http().get(USER_VERCEL_CREDENTIAL_PATH).expect(401)
    await http().put(USER_VERCEL_CREDENTIAL_PATH).send(FULL).expect(401)
    await http().delete(USER_VERCEL_CREDENTIAL_PATH).expect(401)
  })

  it('reads unconfigured, saves a sealed token and never returns it', async () => {
    const empty = await get('session-a').expect(200)
    expect(empty.body).toEqual({
      configured: false,
      teamId: null,
      vercelProjectId: null,
      updatedAt: null,
    })

    await put('session-a', FULL).expect(204)
    const row = await credentialOf('user-a')
    expect(row).toMatchObject({ teamId: 'team_1', vercelProjectId: 'prj_1' })
    expect(row?.sealedToken).not.toContain('vtok_secret')
    const cipher = app.get(SecretCipherService)
    expect(openSecretValue({ cipher, sealed: row?.sealedToken ?? '' })).toBe('vtok_secret')

    const read = await get('session-a').expect(200)
    expect(userVercelCredentialSchema.parse(read.body)).toMatchObject({
      configured: true,
      teamId: 'team_1',
      vercelProjectId: 'prj_1',
    })
    expect(Number.isNaN(Date.parse(read.body.updatedAt))).toBe(false)
    expect(JSON.stringify(read.body)).not.toContain('vtok')
  })

  it('needs a token the first time and keeps it when a later PUT omits it', async () => {
    const withoutToken = { teamId: 'team_1', vercelProjectId: 'prj_1' }
    const refused = await put('session-a', withoutToken).expect(400)
    expect(refused.body.message).toBe('a token is required the first time')
    expect(await credentialOf('user-a')).toBeNull()

    await put('session-a', FULL).expect(204)
    const sealed = (await credentialOf('user-a'))?.sealedToken
    await put('session-a', { teamId: 'team_2', vercelProjectId: 'prj_2' }).expect(204)
    expect(await credentialOf('user-a')).toMatchObject({
      teamId: 'team_2',
      vercelProjectId: 'prj_2',
      sealedToken: sealed,
    })

    await put('session-a', { ...FULL, token: 'vtok_rotated' }).expect(204)
    expect((await credentialOf('user-a'))?.sealedToken).not.toBe(sealed)
  })

  it('requires team and vercel project id and rejects malformed bodies', async () => {
    await put('session-a', { ...FULL, token: '' }).expect(400)
    await put('session-a', { token: 't', vercelProjectId: 'prj_1' }).expect(400)
    await put('session-a', { token: 't', teamId: 'team_1' }).expect(400)
    await put('session-a', { token: 't', teamId: 'team_1', vercelProjectId: '  ' }).expect(400)
    expect(await credentialOf('user-a')).toBeNull()
  })

  it('keeps each user credential private to that user', async () => {
    await put('session-a', FULL).expect(204)
    const other = await get('session-b').expect(200)
    expect(other.body.configured).toBe(false)
    await put('session-b', { teamId: 'team_b', vercelProjectId: 'prj_b' }).expect(400)

    await http().delete(USER_VERCEL_CREDENTIAL_PATH).set(as('session-b')).expect(204)
    expect(await credentialOf('user-a')).not.toBeNull()
  })

  it('deletes the credential, and deleting twice is fine', async () => {
    await put('session-a', FULL).expect(204)
    await http().delete(USER_VERCEL_CREDENTIAL_PATH).set(as('session-a')).expect(204)
    expect(await credentialOf('user-a')).toBeNull()
    await http().delete(USER_VERCEL_CREDENTIAL_PATH).set(as('session-a')).expect(204)
    expect((await get('session-a').expect(200)).body.configured).toBe(false)
  })
})
