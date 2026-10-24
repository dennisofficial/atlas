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

  it('stores a secret kind and keeps secrets.list free of it', async () => {
    await set('session-a', { name: 'OPENAI_KEY', value: 'sk-1', kind: 'env' }).expect(200)
    await set('session-a', { name: 'plain', value: 'p' }).expect(200)
    await set('session-a', { name: 'OPENAI_KEY', value: 'sk-2' }).expect(200)

    const legacy = await query('secrets.list', 'session-a').expect(200)
    expect(legacy.body.result.data.secrets).toHaveLength(2)
    for (const entry of legacy.body.result.data.secrets) {
      expect(Object.keys(entry).sort()).toEqual(['name', 'updatedAt', 'value'])
    }

    const details = await query('secrets.details', 'session-a').expect(200)
    expect(details.headers['cache-control']).toBe('no-store')
    const rows: { name: string; kind: string }[] = details.body.result.data.secrets
    expect(Object.fromEntries(rows.map((entry) => [entry.name, entry.kind]))).toEqual({
      OPENAI_KEY: 'env',
      plain: 'secret',
    })
    expect(rows[0]).toEqual(
      expect.objectContaining({ createdAt: expect.any(String), updatedAt: expect.any(String) }),
    )
  })

  it('rejects an unknown secret kind and scopes details to the caller', async () => {
    await set('session-a', { name: 'X', value: 'v', kind: 'weird' }).expect(400)
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
