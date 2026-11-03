import type { INestApplication } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { userVercelCredentialSchema } from '@dltech/atlas-wire/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { openSecretValue } from '../secrets/sealed-secret'
import {
  buildSessionTrpcApp,
  dataOf,
  errorMessageOf,
  trpcMutation,
  trpcQuery,
} from '../session-trpc-test-app'
import { seedSessionUsers } from '../../../test/web-settings.fake-db'
import { UserVercelRouter } from './user-vercel.router'
import { UserVercelService } from './user-vercel.service'
import { VercelPlanService } from './vercel-credential-plan'
import { VercelFetcher, VercelOauthConfig } from './vercel-oauth.types'
import { VercelTokenRefresher } from './vercel-token-refresher'

const GOOD_TOKEN = 'vtok_discover'

const stubDiscoverFetch = (): VercelFetcher => {
  const stub = new VercelFetcher()
  stub.fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const bearer = new Headers(init?.headers).get('authorization') ?? ''
    const token = bearer.replace(/^Bearer /, '')
    if (token === 'vtok_bogus') {
      return new Response(JSON.stringify({ error: { message: 'forbidden' } }), { status: 403 })
    }
    if (input.startsWith('https://api.vercel.com/v2/teams?')) {
      return new Response(
        JSON.stringify({
          teams: [
            { id: 'team_one', slug: 'one-team', billing: { plan: 'enterprise' } },
            { id: 'team_two', slug: 'two-team', billing: { plan: 'pro' } },
          ],
        }),
        { status: 200 },
      )
    }
    if (input.startsWith('https://api.vercel.com/v2/teams/')) {
      return new Response(JSON.stringify({ id: 'team_1', billing: { plan: 'enterprise' } }), {
        status: 200,
      })
    }
    if (input.startsWith('https://api.vercel.com/v9/projects')) {
      const teamId = new URL(input).searchParams.get('teamId')
      return new Response(JSON.stringify({ projects: [{ id: 'prj_1', name: `web-${teamId}` }] }), {
        status: 200,
      })
    }
    return new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 })
  })
  return stub
}

const credentialOf = (userId: string) => db.orm.public.UserVercelCredential.first({ userId })
const FULL = { token: 'vtok_secret', teamId: 'team_1', vercelProjectId: 'prj_1' }

describe('UserVercelRouter', () => {
  useTestDatabase()
  let app: INestApplication
  const save = (token: string | undefined, input: object) =>
    trpcMutation({ app, path: 'userVercel.save', token, input })
  const get = (token: string | undefined) => trpcQuery({ app, path: 'userVercel.get', token })
  const remove = (token: string | undefined) =>
    trpcMutation({ app, path: 'userVercel.remove', token })

  beforeEach(async () => {
    await seedSessionUsers()
    const config = new VercelOauthConfig()
    config.redirectUri = 'https://api.test/v1/vercel/oauth/callback'
    config.webOrigin = 'https://web.test'
    app = await buildSessionTrpcApp({
      providers: [
        UserVercelRouter,
        UserVercelService,
        VercelPlanService,
        VercelTokenRefresher,
        { provide: VercelFetcher, useValue: stubDiscoverFetch() },
        { provide: VercelOauthConfig, useValue: config },
      ],
    })
  })

  afterEach(() => app.close())

  it('requires a session', async () => {
    await get(undefined).expect(401)
    await save(undefined, FULL).expect(401)
    await remove(undefined).expect(401)
  })

  it('reads unconfigured, saves a sealed token and never returns it', async () => {
    const empty = await get('session-a').expect(200)
    expect(empty.headers['cache-control']).toBe('no-store')
    expect(dataOf(empty.body)).toEqual({
      configured: false,
      kind: 'token',
      teamId: null,
      vercelProjectId: null,
      plan: 'unknown',
      planCheckedAt: null,
      needsReconnect: false,
      vercelUserId: null,
      oauthConfigured: true,
      updatedAt: null,
    })

    await save('session-a', FULL).expect(200)
    const row = await credentialOf('user-a')
    expect(row).toMatchObject({ teamId: 'team_1', vercelProjectId: 'prj_1' })
    expect(row?.sealedToken).not.toContain('vtok_secret')
    const cipher = app.get(SecretCipherService)
    expect(openSecretValue({ cipher, sealed: row?.sealedToken ?? '' })).toBe('vtok_secret')

    const read = userVercelCredentialSchema.parse(dataOf((await get('session-a').expect(200)).body))
    expect(read).toMatchObject({ configured: true, teamId: 'team_1', vercelProjectId: 'prj_1' })
    expect(Number.isNaN(Date.parse(read.updatedAt ?? ''))).toBe(false)
    expect(JSON.stringify(read)).not.toContain('vtok')
  })

  it('needs a token the first time and keeps it when a later save omits it', async () => {
    const withoutToken = { teamId: 'team_1', vercelProjectId: 'prj_1' }
    const refused = await save('session-a', withoutToken).expect(400)
    expect(errorMessageOf(refused.body)).toBe('a token is required the first time')
    expect(await credentialOf('user-a')).toBeNull()

    await save('session-a', FULL).expect(200)
    const sealed = (await credentialOf('user-a'))?.sealedToken
    await save('session-a', { teamId: 'team_2', vercelProjectId: 'prj_2' }).expect(200)
    expect(await credentialOf('user-a')).toMatchObject({
      teamId: 'team_2',
      vercelProjectId: 'prj_2',
      sealedToken: sealed,
    })

    await save('session-a', { ...FULL, token: 'vtok_rotated' }).expect(200)
    expect((await credentialOf('user-a'))?.sealedToken).not.toBe(sealed)
  })

  it('requires team and vercel project id and rejects malformed input', async () => {
    await save('session-a', { ...FULL, token: '' }).expect(400)
    await save('session-a', { token: 't', vercelProjectId: 'prj_1' }).expect(400)
    await save('session-a', { token: 't', teamId: 'team_1' }).expect(400)
    await save('session-a', { token: 't', teamId: 'team_1', vercelProjectId: '  ' }).expect(400)
    expect(await credentialOf('user-a')).toBeNull()
  })

  it('keeps each user credential private to that user', async () => {
    await save('session-a', FULL).expect(200)
    const other = await get('session-b').expect(200)
    expect(dataOf(other.body)).toMatchObject({ configured: false })
    await save('session-b', { teamId: 'team_b', vercelProjectId: 'prj_b' }).expect(400)

    await remove('session-b').expect(200)
    expect(await credentialOf('user-a')).not.toBeNull()
  })

  it('requires a session for discover', async () => {
    await trpcMutation({ app, path: 'userVercel.discover', token: undefined, input: {} }).expect(
      401,
    )
  })

  it('discovers teams for a pasted token and projects when a team is given', async () => {
    const teamsOnly = dataOf(
      (
        await trpcMutation({
          app,
          path: 'userVercel.discover',
          token: 'session-a',
          input: { token: GOOD_TOKEN },
        }).expect(200)
      ).body,
    )
    expect(teamsOnly).toEqual({
      teams: [
        { id: 'team_one', slug: 'one-team', name: null, plan: 'enterprise' },
        { id: 'team_two', slug: 'two-team', name: null, plan: 'pro' },
      ],
      projects: [],
    })

    const withTeam = dataOf(
      (
        await trpcMutation({
          app,
          path: 'userVercel.discover',
          token: 'session-a',
          input: { token: GOOD_TOKEN, teamId: 'team_one' },
        }).expect(200)
      ).body,
    )
    expect(withTeam).toEqual({
      teams: (teamsOnly as { teams: unknown[] }).teams,
      projects: [{ id: 'prj_1', name: 'web-team_one' }],
    })
  })

  it('discovers with the stored token when none is pasted', async () => {
    await save('session-a', FULL).expect(200)
    const discovered = dataOf(
      (
        await trpcMutation({
          app,
          path: 'userVercel.discover',
          token: 'session-a',
          input: { teamId: 'team_1' },
        }).expect(200)
      ).body,
    )
    expect(discovered).toEqual({
      teams: [
        { id: 'team_one', slug: 'one-team', name: null, plan: 'enterprise' },
        { id: 'team_two', slug: 'two-team', name: null, plan: 'pro' },
      ],
      projects: [{ id: 'prj_1', name: 'web-team_1' }],
    })
    expect(JSON.stringify(discovered)).not.toContain(FULL.token)
  })

  it('refuses discover without a token or a saved credential', async () => {
    const refused = await trpcMutation({
      app,
      path: 'userVercel.discover',
      token: 'session-b',
      input: {},
    }).expect(400)
    expect(errorMessageOf(refused.body)).toBe('paste a token or save one first')
  })

  it('answers 400 with the Vercel message for a bad token and never echoes it', async () => {
    const refused = await trpcMutation({
      app,
      path: 'userVercel.discover',
      token: 'session-a',
      input: { token: 'vtok_bogus' },
    }).expect(400)
    expect(errorMessageOf(refused.body)).toContain('forbidden')
    expect(JSON.stringify(refused.body)).not.toContain('vtok_bogus')
  })

  it('deletes the credential, and deleting twice is fine', async () => {
    await save('session-a', FULL).expect(200)
    await remove('session-a').expect(200)
    expect(await credentialOf('user-a')).toBeNull()
    await remove('session-a').expect(200)
    expect(dataOf((await get('session-a').expect(200)).body)).toMatchObject({ configured: false })
  })
})
