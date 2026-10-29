import type { INestApplication } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { claimSandboxInputSchema } from '@dltech/atlas-wire'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import {
  seedSandboxRow,
  seedThreadRow,
  seedUsers,
  USER_A,
  USER_B,
} from '../../../../test/session-seed'
import { DEFAULT_RATE_LIMIT } from '../../../_module/trpc/trpc-middleware.fixture'
import {
  asUser,
  createSandboxRoutersApp,
  getCheckpoint,
  sandboxesPath,
} from './sandbox-routers.fixture'
import { prepareSandboxes, THREAD } from './sandboxes.fixture'

const CLIENT_TOKEN = 'a'.repeat(64)
const SERVE_URL = 'https://atlas-3000-abc.vercel.run'

describe('SandboxesRouter', () => {
  useTestDatabase()
  let app: INestApplication

  beforeAll(async () => {
    app = await createSandboxRoutersApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await prepareSandboxes()
  })

  const claim = (body: object, userId: string | null = USER_A) => {
    const call = request(app.getHttpServer()).post(sandboxesPath('claim'))
    return (userId === null ? call : call.set(asUser(userId))).send(body)
  }

  const destroy = (body: object, userId: string | null = USER_A) => {
    const call = request(app.getHttpServer()).post(sandboxesPath('destroy'))
    return (userId === null ? call : call.set(asUser(userId))).send(body)
  }

  const list = (userId: string | null = USER_A) => {
    const call = request(app.getHttpServer()).get(sandboxesPath('list'))
    return userId === null ? call : call.set(asUser(userId))
  }

  it('claims a row and answers the attachment with the minted token', async () => {
    const reply = await claim({ threadId: THREAD, gitToken: 'ghp_x', contextPending: true })

    expect(reply.status).toBe(200)
    expect(reply.body.result.data).toMatchObject({
      threadId: THREAD,
      state: 'resuming',
      contextPending: true,
    })
    expect(reply.body.result.data.token.length).toBeGreaterThan(0)
    expect(reply.body.result.data).not.toHaveProperty('url')
  })

  it('registers a client-provisioned sandbox, answering its token and url', async () => {
    const reply = await claim({
      threadId: THREAD,
      clientToken: CLIENT_TOKEN,
      serveUrl: SERVE_URL,
      serveVersion: '1.42.0',
      metadata: { title: 'fix the flake', repo: 'compai/atlas', model: 'claude-opus-4-6' },
    })

    expect(reply.status).toBe(200)
    expect(reply.body.result.data).toMatchObject({
      threadId: THREAD,
      state: 'running',
      token: CLIENT_TOKEN,
      url: SERVE_URL,
    })
  })

  it('refuses a registration whose serve url is not a Vercel sandbox endpoint', async () => {
    const reply = await claim({
      threadId: THREAD,
      clientToken: CLIENT_TOKEN,
      serveUrl: 'http://box.vercel.run',
    })

    expect(reply.status).toBe(400)
  })

  it('accepts the workspace that released TUIs send on a claim', async () => {
    const reply = await claim({
      threadId: 'brn_1',
      gitToken: 'ghp_x',
      contextPending: true,
      workspace: { remoteUrl: null },
    })

    expect(reply.status).toBe(200)
  })

  it('rejects fields the claim contract does not know, as the REST pipe did', async () => {
    const reply = await claim({ threadId: THREAD, surprise: true })

    expect(reply.status).toBe(400)
  })

  it('rejects a claim with an empty thread id or a short client token', async () => {
    expect((await claim({ threadId: '' })).status).toBe(400)
    expect((await claim({ threadId: THREAD, clientToken: 'short' })).status).toBe(400)
  })

  it('lists the signed-in user sandboxes, newest activity first, and nobody else', async () => {
    await seedSandboxRow({
      threadId: 'brn_old',
      userId: USER_A,
      lastActivityAt: new Date('2026-09-01T00:00:00.000Z'),
    })
    await seedThreadRow({ id: 'brn_new', userId: USER_A })
    await seedSandboxRow({
      threadId: 'brn_new',
      userId: USER_A,
      lastActivityAt: new Date('2026-09-02T00:00:00.000Z'),
    })
    await seedSandboxRow({ threadId: 'brn_theirs', userId: USER_B })

    const reply = await list()

    expect(reply.status).toBe(200)
    expect(reply.body.result.data.map((entry: { threadId: string }) => entry.threadId)).toEqual([
      'brn_new',
      'brn_old',
    ])
    expect(Object.keys(reply.body.result.data[0]).sort()).toEqual([
      'lastActivityAt',
      'name',
      'state',
      'threadId',
    ])
  })

  it('destroys the owned row and answers nothing', async () => {
    await seedSandboxRow({ threadId: THREAD, userId: USER_A })

    const reply = await destroy({ threadId: THREAD })

    expect(reply.status).toBe(200)
    expect(await db.orm.public.CloudSandbox.where({ sessionId: `ses_${THREAD}` }).all()).toEqual([])
  })

  it('404s a destroy of a sandbox the user does not own, leaving the row', async () => {
    await seedSandboxRow({ threadId: THREAD, userId: USER_B })

    const reply = await destroy({ threadId: THREAD })

    expect(reply.status).toBe(404)
    expect(
      await db.orm.public.CloudSandbox.where({ sessionId: `ses_${THREAD}` }).all(),
    ).toHaveLength(1)
  })

  it('answers 401 on every procedure without a session', async () => {
    expect((await list(null)).status).toBe(401)
    expect((await claim({ threadId: THREAD }, null)).status).toBe(401)
    expect((await destroy({ threadId: THREAD }, null)).status).toBe(401)
  })
})

describe('the first-party read throttle', () => {
  useTestDatabase()
  let app: INestApplication

  beforeAll(async () => {
    app = await createSandboxRoutersApp(undefined, DEFAULT_RATE_LIMIT)
  })

  afterAll(async () => {
    await app.close()
  })

  it('raises the limit above the app-wide default on list, claim, destroy and checkpoint get', async () => {
    await seedUsers(USER_A)
    const attempts = DEFAULT_RATE_LIMIT + 2
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const listed = await request(app.getHttpServer())
        .get(sandboxesPath('list'))
        .set(asUser(USER_A))
      const destroyed = await request(app.getHttpServer())
        .post(sandboxesPath('destroy'))
        .set(asUser(USER_A))
        .send({ threadId: 'brn_missing' })
      const read = await getCheckpoint({ app, userId: USER_A, threadId: 'brn_missing' })
      expect([listed.status, destroyed.status, read.status]).toEqual([200, 404, 404])
    }
  })
})

describe('claimSandboxInputSchema', () => {
  it('accepts the claim that released TUIs send', () => {
    expect(
      claimSandboxInputSchema.safeParse({
        threadId: 'brn_1',
        gitToken: 'ghp_x',
        contextPending: true,
      }).success,
    ).toBe(true)
  })

  it('rejects an unknown key, an empty thread id and the retired driveName', () => {
    expect(claimSandboxInputSchema.safeParse({ threadId: 'brn_1', extra: 1 }).success).toBe(false)
    expect(claimSandboxInputSchema.safeParse({ threadId: '' }).success).toBe(false)
    expect(
      claimSandboxInputSchema.safeParse({ threadId: 'brn_1', driveName: 'atlas-drive-brn_1' })
        .success,
    ).toBe(false)
  })
})
