import type { INestApplication } from '@nestjs/common'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { composerDraftGetReplySchema } from '@dltech/atlas-wire'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { seedThreadRow } from '../../../../test/session-seed'
import { buildSessionTrpcApp, dataOf, trpcMutation, trpcQuery } from '../session-trpc-test-app'
import { seedSessionUsers } from '../../../test/web-settings.fake-db'
import { ComposerDraftsRouter } from './composer-drafts.router'
import { ComposerDraftsService } from './composer-drafts.service'

const upload = {
  uploadId: '4f9b2f6c-9b7a-4a2e-8f6f-3f0f0e0a1b2c',
  pathname: 'composer-uploads/user-a/4f9b2f6c-9b7a-4a2e-8f6f-3f0f0e0a1b2c/note.txt',
  name: 'note.txt',
  size: 12,
  mediaType: 'text/plain',
}

describe('ComposerDraftsRouter', () => {
  useTestDatabase()
  let app: INestApplication
  const mutate = (path: string, token: string | undefined, input?: unknown) =>
    trpcMutation({ app, path: `composerDrafts.${path}`, token, input })
  const query = (path: string, token: string | undefined, input?: unknown) =>
    trpcQuery({ app, path: `composerDrafts.${path}`, token, input })

  beforeEach(async () => {
    await seedSessionUsers()
    await seedThreadRow({ id: 'thread-a', userId: 'user-a' })
    await seedThreadRow({ id: 'thread-b', userId: 'user-b' })
    app = await buildSessionTrpcApp({
      providers: [ComposerDraftsRouter, ComposerDraftsService],
    })
  })

  afterEach(() => app.close())

  it('round-trips a draft with attachments for an owned thread', async () => {
    await mutate('put', 'session-a', {
      scope: 'thread-a',
      text: 'hello pod',
      uploads: [upload],
    }).expect(200)

    const res = await query('get', 'session-a', { scope: 'thread-a' }).expect(200)
    const reply = composerDraftGetReplySchema.parse(dataOf(res.body))
    expect(reply.draft).toMatchObject({ scope: 'thread-a', text: 'hello pod', uploads: [upload] })
    expect(typeof reply.draft?.updatedAt).toBe('string')
  })

  it('upserts on the same scope, keeping one row', async () => {
    await mutate('put', 'session-a', { scope: 'thread-a', text: 'first', uploads: [] }).expect(200)
    await mutate('put', 'session-a', { scope: 'thread-a', text: 'second', uploads: [] }).expect(200)
    const res = await query('get', 'session-a', { scope: 'thread-a' }).expect(200)
    expect(composerDraftGetReplySchema.parse(dataOf(res.body)).draft?.text).toBe('second')
  })

  it('keeps a draft without a thread under the new-thread scope', async () => {
    await mutate('put', 'session-a', { scope: 'new', text: 'unborn', uploads: [] }).expect(200)
    const res = await query('get', 'session-a', { scope: 'new' }).expect(200)
    expect(composerDraftGetReplySchema.parse(dataOf(res.body)).draft?.text).toBe('unborn')
  })

  it('answers null when no draft exists', async () => {
    const res = await query('get', 'session-a', { scope: 'thread-a' }).expect(200)
    expect(composerDraftGetReplySchema.parse(dataOf(res.body)).draft).toBeNull()
  })

  it('clear removes the draft and is silent when absent', async () => {
    await mutate('put', 'session-a', { scope: 'thread-a', text: 'x', uploads: [] }).expect(200)
    await mutate('clear', 'session-a', { scope: 'thread-a' }).expect(200)
    const res = await query('get', 'session-a', { scope: 'thread-a' }).expect(200)
    expect(composerDraftGetReplySchema.parse(dataOf(res.body)).draft).toBeNull()
    await mutate('clear', 'session-a', { scope: 'thread-a' }).expect(200)
  })

  it('refuses a thread the caller does not own', async () => {
    await mutate('put', 'session-a', { scope: 'thread-b', text: 'x', uploads: [] }).expect(404)
    await query('get', 'session-a', { scope: 'thread-b' }).expect(404)
    await mutate('clear', 'session-a', { scope: 'thread-b' }).expect(404)
  })

  it('keeps drafts per user and per scope', async () => {
    await mutate('put', 'session-a', { scope: 'thread-a', text: 'mine', uploads: [] }).expect(200)
    await mutate('put', 'session-b', { scope: 'new', text: 'theirs', uploads: [] }).expect(200)
    const mine = await query('get', 'session-a', { scope: 'thread-a' }).expect(200)
    const other = await query('get', 'session-b', { scope: 'new' }).expect(200)
    expect(composerDraftGetReplySchema.parse(dataOf(mine.body)).draft?.text).toBe('mine')
    expect(composerDraftGetReplySchema.parse(dataOf(other.body)).draft?.text).toBe('theirs')
  })

  it('rejects an anonymous caller', async () => {
    await mutate('put', undefined, { scope: 'thread-a', text: 'x', uploads: [] }).expect(401)
    await query('get', undefined, { scope: 'thread-a' }).expect(401)
  })

  it('removes the draft when its session is deleted', async () => {
    await mutate('put', 'session-a', { scope: 'thread-a', text: 'x', uploads: [] }).expect(200)
    const { db } = await import('@dltech/atlas-db')
    const thread = await db.orm.public.Thread.where({ id: 'thread-a' }).first()
    await db.orm.public.Session.where({ id: thread?.sessionId ?? '' }).delete()
    const res = await query('get', 'session-a', { scope: 'thread-a' })
    expect(res.status).toBe(404)
  })
})
