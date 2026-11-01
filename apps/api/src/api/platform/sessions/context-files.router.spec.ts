import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { seedThreadRow, seedUsers } from '../../../../test/session-seed'
import { ContextFilesRouter } from './context-files.router'
import { createSessionsRouterApp, query, session, USER_ID } from './threads-routers.fixture'

const OTHER_USER = 'usr-2'

const put = async (args: { threadId: string; path: string; content: string }) => {
  await db.orm.public.ContextFile.create({
    id: `ctxf_${args.threadId}_${args.path}`,
    threadId: args.threadId,
    path: args.path,
    content: args.content,
    digest: 'x',
    updatedAt: new Date(),
  })
}

describe('ContextFilesRouter', () => {
  useTestDatabase()
  let app: NestExpressApplication

  beforeAll(async () => {
    app = await createSessionsRouterApp({ extraProviders: [ContextFilesRouter] })
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await seedUsers(USER_ID, OTHER_USER)
    await seedThreadRow({ id: 'thr-1', userId: USER_ID })
    await seedThreadRow({ id: 'thr-other', userId: OTHER_USER })
  })

  describe('list', () => {
    it('rejects a caller with no session', async () => {
      const reply = await query({
        app,
        procedure: 'contextFiles.list',
        input: { threadId: 'thr-1' },
      })
      expect(reply.status).toBe(401)
    })

    it('lists the mirrored tree of an owned thread as directory entries', async () => {
      await put({ threadId: 'thr-1', path: 'plan.md', content: 'v1' })
      await put({ threadId: 'thr-1', path: 'notes/a.md', content: 'a' })
      await put({ threadId: 'thr-1', path: 'notes/deep/b.md', content: 'b' })
      await put({ threadId: 'thr-other', path: 'theirs.md', content: 'theirs' })

      const root = await query({
        app,
        procedure: 'contextFiles.list',
        headers: session,
        input: { threadId: 'thr-1' },
      })
      expect(root.status).toBe(200)
      expect(root.body.result.data).toEqual({
        entries: [
          { name: 'notes', isDirectory: true },
          { name: 'plan.md', isDirectory: false },
        ],
      })

      const notes = await query({
        app,
        procedure: 'contextFiles.list',
        headers: session,
        input: { threadId: 'thr-1', directory: 'notes' },
      })
      expect(notes.body.result.data).toEqual({
        entries: [
          { name: 'a.md', isDirectory: false },
          { name: 'deep', isDirectory: true },
        ],
      })
    })

    it('404s a thread owned by another user', async () => {
      const reply = await query({
        app,
        procedure: 'contextFiles.list',
        headers: session,
        input: { threadId: 'thr-other' },
      })
      expect(reply.status).toBe(404)
    })
  })

  describe('read', () => {
    it('returns the mirrored content of an owned thread', async () => {
      await put({ threadId: 'thr-1', path: 'plan.md', content: 'the plan' })
      const reply = await query({
        app,
        procedure: 'contextFiles.read',
        headers: session,
        input: { threadId: 'thr-1', path: 'plan.md' },
      })
      expect(reply.status).toBe(200)
      expect(reply.body.result.data).toEqual({
        file: { type: 'text', content: 'the plan', truncated: false },
      })
    })

    it('answers refused for a path with no mirrored row', async () => {
      const reply = await query({
        app,
        procedure: 'contextFiles.read',
        headers: session,
        input: { threadId: 'thr-1', path: 'missing.md' },
      })
      expect(reply.status).toBe(200)
      expect(reply.body.result.data.file.type).toBe('refused')
    })
  })
})
