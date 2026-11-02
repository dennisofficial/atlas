import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { INestApplication } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createPersonalApp, trpcMutate, trpcQuery } from '../personal-resources.router.fixture'
import { seedSessionUsers } from '../../../test/web-settings.fake-db'
import { SecretsRouter } from './secrets.router'
import { SecretsService } from './secrets.service'

describe('SecretsRouter', () => {
  useTestDatabase()
  const secrets = () => db.orm.public.UserSecret.where((row) => row.id.neq('')).all()
  let app: INestApplication
  const set = (token: string | undefined, input: object) =>
    trpcMutate({ app, procedure: 'secrets.set', token, input })
  const query = (procedure: string, token?: string) => trpcQuery({ app, procedure, token })

  beforeEach(async () => {
    await seedSessionUsers()
    app = await createPersonalApp([SecretsRouter, SecretsService])
  })

  afterEach(() => app.close())

  it('lists summaries without any value', async () => {
    await set('session-a', { name: 'OPENAI_KEY', value: 'sk-1' }).expect(200)
    await set('session-a', { name: 'plain', value: 'p' }).expect(200)

    const details = await query('secrets.details', 'session-a').expect(200)
    expect(details.headers['cache-control']).toBe('no-store')
    expect(details.text).not.toContain('sk-1')
    for (const entry of details.body.result.data.secrets) {
      expect(Object.keys(entry).sort()).toEqual(['createdAt', 'name', 'updatedAt'])
    }
  })

  it('no longer exposes a bulk secrets.list', async () => {
    await query('secrets.list', 'session-a').expect(404)
  })

  it('rejects dotted and other non-env names on set', async () => {
    for (const name of ['search.tavily', 'decisions.token.typesafe', '1X', 'a b'])
      await set('session-a', { name, value: 'v' }).expect(400)
    expect(await secrets()).toHaveLength(0)
  })

  it('reveals one value to a fresh session or the owner\u2019s sandbox only', async () => {
    await set('session-a', { name: 'OPENAI_KEY', value: 'sk-1' }).expect(200)
    const reveal = (token?: string, name = 'OPENAI_KEY') =>
      trpcQuery({ app, procedure: 'secrets.reveal', token, input: { name } })

    const ok = await reveal('session-a').expect(200)
    expect(ok.body.result.data).toEqual({ value: 'sk-1' })
    await reveal('session-b').expect(404)
    await reveal().expect(401)
    await reveal('pod-token-a').expect(403)
  })

  it('answers REAUTH_REQUIRED and no value to a session older than the fresh window', async () => {
    await set('session-a', { name: 'OPENAI_KEY', value: 'sk-1' }).expect(200)
    const stale = await trpcQuery({
      app,
      procedure: 'secrets.reveal',
      token: 'stale:session-a',
      input: { name: 'OPENAI_KEY' },
    }).expect(403)
    expect(stale.text).toContain('REAUTH_REQUIRED')
    expect(stale.text).not.toContain('sk-1')
  })

  it('lists secret names without any value or ciphertext', async () => {
    await set('session-a', { name: 'TAVILY', value: 'tvly-plaintext' }).expect(200)
    await set('session-a', { name: 'TYPESAFE', value: 'jev-plaintext' }).expect(200)
    await set('session-b', { name: 'EXA', value: 'exa-plaintext' }).expect(200)
    const sealed = (await secrets()).map((row) => row.sealedValue)

    const reply = await query('secrets.names', 'session-a').expect(200)
    expect(reply.body.result.data).toEqual({
      names: ['TAVILY', 'TYPESAFE'],
    })
    for (const leaked of ['tvly-plaintext', 'jev-plaintext', 'exa-plaintext', ...sealed]) {
      expect(reply.text).not.toContain(leaked)
    }
  })

  it('answers secrets.names to a session only', async () => {
    await query('secrets.names').expect(401)
    await query('secrets.names', 'pod-token-a').expect(401)
    await query('secrets.names', 'sandbox-token-a').expect(401)
  })

  it('scopes details to the caller', async () => {
    await set('session-a', { name: 'X', value: 'v' }).expect(200)

    const other = await query('secrets.details', 'session-b').expect(200)
    expect(other.body.result.data.secrets).toEqual([])
    await query('secrets.details').expect(401)
    await query('secrets.details', 'pod-token-a').expect(403)
  })

  describe('sandbox reach', () => {
    it('lets a sandbox list, set and remove its owner\u2019s personal secrets', async () => {
      const sandboxList = await query('secrets.details', 'sandbox-token-a').expect(200)
      expect(sandboxList.body.result.data.secrets).toEqual([])

      await set('sandbox-token-a', { name: 'EXA_KEY', value: 'exa-1' }).expect(200)
      const rows = await db.orm.public.UserSecret.where((row) => row.userId.eq('user-a')).all()
      expect(rows.map((row) => row.name)).toEqual(['EXA_KEY'])

      const listed = await query('secrets.details', 'sandbox-token-a').expect(200)
      expect(listed.body.result.data.secrets.map((row: { name: string }) => row.name)).toEqual([
        'EXA_KEY',
      ])

      const removed = await trpcMutate({
        app,
        procedure: 'secrets.remove',
        token: 'sandbox-token-a',
        input: { name: 'EXA_KEY' },
      }).expect(200)
      expect(removed.body).toEqual({ result: {} })
      expect(await db.orm.public.UserSecret.where((row) => row.id.neq('')).all()).toHaveLength(0)
    })

    it('reveals a personal secret to its owner\u2019s sandbox', async () => {
      await set('session-a', { name: 'OPENAI_KEY', value: 'sk-1' }).expect(200)

      const reply = await trpcQuery({
        app,
        procedure: 'secrets.reveal',
        token: 'sandbox-token-a',
        input: { name: 'OPENAI_KEY' },
      }).expect(200)
      expect(reply.body.result.data).toEqual({ value: 'sk-1' })
    })

    it('cannot read another user\u2019s personal secrets', async () => {
      await set('session-b', { name: 'B_KEY', value: 'b-plaintext' }).expect(200)

      const listed = await query('secrets.details', 'sandbox-token-a').expect(200)
      expect(listed.body.result.data.secrets).toEqual([])
      expect(listed.text).not.toContain('b-plaintext')
      await trpcQuery({
        app,
        procedure: 'secrets.reveal',
        token: 'sandbox-token-a',
        input: { name: 'B_KEY' },
      }).expect(404)

      const removed = await trpcMutate({
        app,
        procedure: 'secrets.remove',
        token: 'sandbox-token-a',
        input: { name: 'B_KEY' },
      }).expect(200)
      expect(
        await db.orm.public.UserSecret.where((row) => row.userId.eq('user-b')).all(),
      ).toHaveLength(1)
      await set('sandbox-token-a', { name: 'B_KEY', value: 'takeover' }).expect(200)
      expect(
        (await db.orm.public.UserSecret.where((row) => row.userId.eq('user-b')).all()).map(
          (row) => row.name,
        ),
      ).toEqual(['B_KEY'])
      expect(
        (await db.orm.public.UserSecret.where((row) => row.userId.eq('user-a')).all()).map(
          (row) => row.name,
        ),
      ).toEqual(['B_KEY'])
    })

    it('refuses a pod bearer on secrets.details, reveal, set and remove', async () => {
      await set('session-a', { name: 'OPENAI_KEY', value: 'sk-1' }).expect(200)

      await query('secrets.details', 'pod-token-a').expect(403)
      await trpcQuery({
        app,
        procedure: 'secrets.reveal',
        token: 'pod-token-a',
        input: { name: 'OPENAI_KEY' },
      }).expect(403)
      await set('pod-token-a', { name: 'X', value: 'v' }).expect(403)
      await trpcMutate({
        app,
        procedure: 'secrets.remove',
        token: 'pod-token-a',
        input: { name: 'OPENAI_KEY' },
      }).expect(403)
      expect(await db.orm.public.UserSecret.where((row) => row.id.neq('')).all()).toHaveLength(1)
    })
  })

  it('accepts a well-formed body and rejects an unknown property or a missing value', async () => {
    await set('session-a', { name: 'WEB_SEARCH_KEY', value: 'sk-search-1' }).expect(200)
    await set('session-a', { name: 'WEB_SEARCH_KEY', value: 'sk-search-1', bogus: true }).expect(
      400,
    )
    await set('session-a', { name: 'WEB_SEARCH_KEY' }).expect(400)
    expect(await secrets()).toHaveLength(1)
  })
})
