import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { INestApplication } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  cipher,
  createPersonalApp,
  trpcMutate,
  trpcQuery,
} from '../personal-resources.router.fixture'
import { seedSessionUsers } from '../web-settings.fake-db'
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

  it('lists summaries without any value and keeps secrets.list carrying values', async () => {
    await set('session-a', { name: 'OPENAI_KEY', value: 'sk-1' }).expect(200)
    await set('session-a', { name: 'plain', value: 'p' }).expect(200)

    const machine = await query('secrets.list', 'session-a').expect(200)
    for (const entry of machine.body.result.data.secrets) {
      expect(Object.keys(entry).sort()).toEqual(['name', 'updatedAt', 'value'])
    }

    const details = await query('secrets.details', 'session-a').expect(200)
    expect(details.headers['cache-control']).toBe('no-store')
    expect(details.text).not.toContain('sk-1')
    for (const entry of details.body.result.data.secrets) {
      expect(Object.keys(entry).sort()).toEqual(['createdAt', 'name', 'updatedAt'])
    }
  })

  it('reveals one value to a fresh session of its owner only', async () => {
    await set('session-a', { name: 'OPENAI_KEY', value: 'sk-1' }).expect(200)
    const reveal = (token?: string, name = 'OPENAI_KEY') =>
      trpcQuery({ app, procedure: 'secrets.reveal', token, input: { name } })

    const ok = await reveal('session-a').expect(200)
    expect(ok.body.result.data).toEqual({ value: 'sk-1' })
    await reveal('session-b').expect(404)
    await reveal().expect(401)
    await reveal('pod-token-a').expect(401)
    await reveal('sandbox-token-a').expect(401)
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
    await set('session-a', { name: 'search.tavily', value: 'tvly-plaintext' }).expect(200)
    await set('session-a', { name: 'decisions.token.typesafe', value: 'jev-plaintext' }).expect(200)
    await set('session-b', { name: 'search.exa', value: 'exa-plaintext' }).expect(200)
    const sealed = (await secrets()).map((row) => row.sealedValue)

    const reply = await query('secrets.names', 'session-a').expect(200)
    expect(reply.body.result.data).toEqual({
      names: ['decisions.token.typesafe', 'search.tavily'],
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
  })

  it('accepts a well-formed body and rejects an unknown property or a missing value', async () => {
    await set('session-a', { name: 'web.searchKey', value: 'sk-search-1' }).expect(200)
    await set('session-a', { name: 'web.searchKey', value: 'sk-search-1', bogus: true }).expect(400)
    await set('session-a', { name: 'web.searchKey' }).expect(400)
    expect(await secrets()).toHaveLength(1)
  })

  it('refuses a bearer that is neither a session nor a registered sandbox or pod', async () => {
    await query('secrets.list', 'unregistered-sandbox-token').expect(401)
  })

  describe('pod reach', () => {
    beforeEach(async () => {
      const stamp = new Date('2026-10-03T00:00:00.000Z')
      for (const [userId, value] of [
        ['user-a', 'vercel-a'],
        ['user-b', 'vercel-b'],
      ] as const) {
        await db.orm.public.UserSecret.create({
          id: `sec_${userId}`,
          userId,
          name: 'VERCEL_TOKEN',
          sealedValue: cipher.encrypt(JSON.stringify(value)),
          createdAt: stamp,
          updatedAt: stamp,
        })
      }
    })

    it("reads the pod owner's secrets only, no-store", async () => {
      const reply = await query('secrets.list', 'pod-token-a').expect(200)

      expect(reply.headers['cache-control']).toBe('no-store')
      expect(reply.body.result.data.secrets).toEqual([
        { name: 'VERCEL_TOKEN', value: 'vercel-a', updatedAt: '2026-10-03T00:00:00.000Z' },
      ])
    })

    it('lets a sandbox principal read its owner’s secrets', async () => {
      const reply = await query('secrets.list', 'sandbox-token-a').expect(200)

      expect(reply.body.result.data.secrets).toHaveLength(1)
    })

    it('refuses a pod bearer on secret writes and on details', async () => {
      await set('pod-token-a', { name: 'NAME', value: 'x' }).expect(401)
      await trpcMutate({
        app,
        procedure: 'secrets.remove',
        token: 'pod-token-a',
        input: { name: 'VERCEL_TOKEN' },
      }).expect(401)
      await query('secrets.details', 'pod-token-a').expect(401)
      expect(await secrets()).toHaveLength(2)
    })

    it('still writes and removes secrets for a session', async () => {
      await set('session-a', { name: 'NAME', value: 'x' }).expect(200)
      expect(
        await db.orm.public.UserSecret.where({ userId: 'user-a', name: 'NAME' }).first(),
      ).not.toBeNull()

      const removed = await trpcMutate({
        app,
        procedure: 'secrets.remove',
        token: 'session-a',
        input: { name: 'NAME' },
      }).expect(200)
      expect(removed.body).toEqual({ result: {} })
      expect(await db.orm.public.UserSecret.where({ userId: 'user-a' }).all()).toHaveLength(1)
    })

    it('answers 401 to a missing bearer', async () => {
      await query('secrets.list').expect(401)
    })
  })
})
