import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { EAttachmentStore, type Attachment } from '@dltech/atlas-core'
import { db } from '@dltech/atlas-db'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { sessionDraftGetOutputSchema, sessionDraftSchema } from '@dltech/atlas-protocol'
import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import {
  as,
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import { SessionDraftsRouter } from './session-drafts.router'
import { SessionDraftsService } from './session-drafts.service'

const media: Attachment = {
  id: 'att-1',
  name: 'shot.png',
  mediaType: 'image/png',
  size: 12,
  content: { store: EAttachmentStore.Media, hash: 'media-hash-1', inline: 'iVBORw0KGgo=' },
}

const USERS: Record<string, string> = { s1: 'user-a', s2: 'user-b' }

const dataOf = (body: unknown): unknown => {
  if (typeof body !== 'object' || body === null) return undefined
  const result: unknown = Reflect.get(body, 'result')
  if (typeof result !== 'object' || result === null) return undefined
  return Reflect.get(result, 'data')
}

describe('SessionDraftsRouter', () => {
  useTestDatabase()
  let app: NestExpressApplication

  const authed = <T extends request.Test>(call: T, token: string | undefined): T =>
    token === undefined ? call : call.set(as(token))

  const put = (token: string | undefined, input: object) =>
    authed(request(app.getHttpServer()).post('/v1/trpc/sessionDrafts.put'), token).send(input)

  const get = (token: string | undefined, input: object) =>
    authed(
      request(app.getHttpServer()).get(
        `/v1/trpc/sessionDrafts.get?input=${encodeURIComponent(JSON.stringify(input))}`,
      ),
      token,
    )

  const clear = (token: string | undefined, input: object) =>
    authed(request(app.getHttpServer()).post('/v1/trpc/sessionDrafts.clear'), token).send(input)

  beforeEach(async () => {
    for (const id of ['user-a', 'user-b']) await seedUser({ db, id })
    const plane = new ControlPlane({ store: new PostgresControlStore(db) })
    await plane.createSession({
      sessionId: 'ses-a',
      userId: 'user-a',
      projectId: null,
      mainThreadId: 'thr-a',
    })
    await plane.createSession({
      sessionId: 'ses-b',
      userId: 'user-b',
      projectId: null,
      mainThreadId: 'thr-b',
    })
    app = await createMiddlewareApp({
      rateLimit: UNTHROTTLED_RATE_LIMIT,
      providers: [
        SessionDraftsRouter,
        SessionDraftsService,
        SessionMiddleware,
        { provide: ControlPlane, useValue: plane },
        {
          provide: SESSION_VERIFIER,
          useValue: {
            async verify(req: { headers: { authorization?: string } }) {
              const token = (req.headers.authorization ?? '').replace(/^Bearer /i, '')
              const userId = USERS[token]
              return userId === undefined
                ? null
                : { userId, sessionId: `auth-${userId}`, email: '' }
            },
          },
        },
      ],
    })
  })

  afterEach(() => app.close())

  it('round-trips a draft and stores the attachment without its inline bytes', async () => {
    const reply = await put('s1', { sessionId: 'ses-a', text: 'hello pod', attachments: [media] })
    expect(reply.status).toBe(200)
    const written = sessionDraftSchema.parse(dataOf(reply.body))
    expect(written).toMatchObject({ sessionId: 'ses-a', text: 'hello pod' })
    expect(written.attachments[0]?.content).toEqual({
      store: EAttachmentStore.Media,
      hash: 'media-hash-1',
    })

    const back = await get('s1', { sessionId: 'ses-a' })
    expect(back.status).toBe(200)
    const draft = sessionDraftGetOutputSchema.parse(dataOf(back.body)).draft
    expect(draft?.text).toBe('hello pod')
    expect(draft?.attachments[0]?.content).toEqual({
      store: EAttachmentStore.Media,
      hash: 'media-hash-1',
    })
    expect(typeof draft?.updatedAt).toBe('string')

    const rows = await db.orm.v2.V2ComposerDraft.all()
    expect(rows).toHaveLength(1)
    expect(JSON.parse(rows[0]?.attachments ?? '[]')[0].content.inline).toBeUndefined()
  })

  it('keeps one row when the same scope is put twice', async () => {
    await put('s1', { sessionId: 'ses-a', text: 'first', attachments: [] })
    await put('s1', { sessionId: 'ses-a', text: 'second', attachments: [] })
    expect(await db.orm.v2.V2ComposerDraft.all()).toHaveLength(1)
    const back = await get('s1', { sessionId: 'ses-a' })
    expect(sessionDraftGetOutputSchema.parse(dataOf(back.body)).draft?.text).toBe('second')
  })

  it('stores the new-session composer under the new scope key', async () => {
    await put('s1', { sessionId: null, text: 'unborn', attachments: [] })
    const rows = await db.orm.v2.V2ComposerDraft.all()
    expect(rows[0]).toMatchObject({ scopeKey: 'new', sessionId: null, text: 'unborn' })
    const back = await get('s1', { sessionId: null })
    const draft = sessionDraftGetOutputSchema.parse(dataOf(back.body)).draft
    expect(draft).toMatchObject({ sessionId: null, text: 'unborn' })
  })

  it('answers a null draft when none is stored', async () => {
    const back = await get('s1', { sessionId: 'ses-a' })
    expect(back.status).toBe(200)
    expect(sessionDraftGetOutputSchema.parse(dataOf(back.body)).draft).toBeNull()
  })

  it('answers a null draft for a malformed stored row', async () => {
    await db.orm.v2.V2ComposerDraft.create({
      userId: 'user-a',
      scopeKey: 'ses-a',
      sessionId: 'ses-a',
      text: 'x',
      attachments: 'not json',
      updatedAt: new Date(),
    })
    const back = await get('s1', { sessionId: 'ses-a' })
    expect(back.status).toBe(200)
    expect(sessionDraftGetOutputSchema.parse(dataOf(back.body)).draft).toBeNull()
  })

  it('clears a draft and is silent when it is absent', async () => {
    await put('s1', { sessionId: 'ses-a', text: 'x', attachments: [] })
    const first = await clear('s1', { sessionId: 'ses-a' })
    expect(first.status).toBe(200)
    expect(dataOf(first.body)).toEqual({ ok: true })
    const back = await get('s1', { sessionId: 'ses-a' })
    expect(sessionDraftGetOutputSchema.parse(dataOf(back.body)).draft).toBeNull()
    const second = await clear('s1', { sessionId: 'ses-a' })
    expect(second.status).toBe(200)
    expect(await db.orm.v2.V2ComposerDraft.all()).toHaveLength(0)
  })

  it('refuses a session the caller does not own', async () => {
    expect((await put('s1', { sessionId: 'ses-b', text: 'x', attachments: [] })).status).toBe(404)
    expect((await get('s1', { sessionId: 'ses-b' })).status).toBe(404)
    expect((await clear('s1', { sessionId: 'ses-b' })).status).toBe(404)
  })

  it('keeps the new-session draft per user', async () => {
    await put('s1', { sessionId: null, text: 'mine', attachments: [] })
    const other = await get('s2', { sessionId: null })
    expect(sessionDraftGetOutputSchema.parse(dataOf(other.body)).draft).toBeNull()
  })

  it('rejects an anonymous caller', async () => {
    expect((await put(undefined, { sessionId: 'ses-a', text: 'x', attachments: [] })).status).toBe(
      401,
    )
    expect((await get(undefined, { sessionId: 'ses-a' })).status).toBe(401)
    expect((await clear(undefined, { sessionId: 'ses-a' })).status).toBe(401)
  })

  it('drops the draft when its session is deleted', async () => {
    await put('s1', { sessionId: 'ses-a', text: 'x', attachments: [] })
    await db.orm.v2.V2Session.where({ id: 'ses-a' }).delete()
    expect(await db.orm.v2.V2ComposerDraft.all()).toHaveLength(0)
  })
})
