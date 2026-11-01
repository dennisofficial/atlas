import { db } from '@dltech/atlas-db'
import { seedThread, useTestDatabase } from '@dltech/atlas-db/testing'
import type { INestApplication } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { sealSecretValue } from '../secrets/sealed-secret'
import { buildSessionTrpcApp, dataOf, testCipher, trpcQuery } from '../session-trpc-test-app'
import { seedProject, seedSessionUsers } from '../../../test/web-settings.fake-db'
import { SandboxConfigRouter } from './sandbox-config.router'
import { KEY, PROJECT, seedAllScopes, setting, THREAD } from './scoped-config.fixture'
import { ScopedConfigService } from './scoped-config.service'

const SANDBOX_TOKEN = 'sbx-token'
const POD_TOKEN = 'pod-token'

describe('sandboxConfig router', () => {
  useTestDatabase()
  let app: INestApplication

  const getConfig = (args: { token?: string; input?: object } = {}) =>
    trpcQuery({
      app,
      path: 'sandboxConfig.get',
      token: args.token ?? SANDBOX_TOKEN,
      input: args.input,
    })

  beforeEach(async () => {
    await seedSessionUsers()
    app = await buildSessionTrpcApp({
      providers: [
        SandboxConfigRouter,
        { provide: ScopedConfigService, useValue: new ScopedConfigService(testCipher()) },
      ],
      sandboxTokens: { [SANDBOX_TOKEN]: { id: 'sbx-1', threadId: THREAD, userId: 'user-a' } },
      podTokens: { [POD_TOKEN]: { threadId: THREAD, userId: 'user-a' } },
    })
  })

  afterEach(() => app.close())

  it('lets the project beat user for one key, and never carries vercel values', async () => {
    await seedAllScopes(testCipher())
    const response = await getConfig().expect(200)
    const data = dataOf(response.body) as {
      settings: object
      provenance: Record<string, string>
      secrets: object[]
      harnessSecrets: object[]
    }

    expect(response.headers['cache-control']).toBe('no-store')
    expect(data.settings).toEqual({ [KEY]: setting('high') })
    expect(data.provenance[`setting:${KEY}`]).toBe('project')
    expect(data.secrets).toEqual([{ name: 'API', value: 'proj' }])
    expect(data.harnessSecrets).toEqual([{ name: 'search.jina', value: 'jina-key' }])
    const body = JSON.stringify(response.body)
    for (const leaked of ['vercel', 'vtok', 'team_', 'prj_']) expect(body).not.toContain(leaked)
  })

  it('carries a project file mount with decrypted contents and mode', async () => {
    await seedAllScopes(testCipher())
    await db.orm.public.ProjectFileMount.create({
      id: 'pfm-1',
      projectId: PROJECT,
      path: '~/.config/dotenvx/.env',
      sealedContents: sealSecretValue({ cipher: testCipher(), value: 'KEY=1\n' }),
      mode: 0o600,
    })
    const response = await getConfig().expect(200)
    expect(dataOf(response.body)).toMatchObject({
      fileMounts: [{ path: '~/.config/dotenvx/.env', contents: 'KEY=1\n', mode: 0o600 }],
    })
  })

  it('resolves user + defaults when the thread has no project', async () => {
    await seedThread({ db, id: THREAD, userId: 'user-a' })
    await db.orm.public.UserSetting.create({
      id: 'u1',
      userId: 'user-a',
      key: KEY,
      value: setting('medium'),
    })
    const response = await getConfig().expect(200)
    const data = dataOf(response.body) as { settings: object; provenance: Record<string, string> }
    expect(data.settings).toEqual({ [KEY]: setting('medium') })
    expect(data.provenance[`setting:${KEY}`]).toBe('user')
  })

  it('resolves the projectId input when the thread has no project', async () => {
    await seedThread({ db, id: THREAD, userId: 'user-a' })
    await seedProject({ id: PROJECT, ownerUserId: 'user-a' })
    await db.orm.public.ProjectSetting.create({
      id: 'p1',
      projectId: PROJECT,
      key: KEY,
      value: setting('high'),
    })
    const response = await getConfig({ input: { projectId: PROJECT } }).expect(200)
    const data = dataOf(response.body) as { settings: object; provenance: Record<string, string> }
    expect(data.settings).toEqual({ [KEY]: setting('high') })
    expect(data.provenance[`setting:${KEY}`]).toBe('project')
  })

  it('serves a pod token its thread’s config', async () => {
    await seedAllScopes(testCipher())
    const response = await getConfig({ token: POD_TOKEN }).expect(200)
    expect(dataOf(response.body)).toMatchObject({ settings: { [KEY]: setting('high') } })
  })

  it('rejects an unknown input property with 400', async () => {
    await getConfig({ input: { projectId: PROJECT, extra: true } }).expect(400)
  })

  it('refuses a user session with 403 and an unknown or missing token with 401', async () => {
    await getConfig({ token: 'session-a' }).expect(403)
    await trpcQuery({ app, path: 'sandboxConfig.get' }).expect(401)
    await getConfig({ token: 'nope' }).expect(401)
  })
})
