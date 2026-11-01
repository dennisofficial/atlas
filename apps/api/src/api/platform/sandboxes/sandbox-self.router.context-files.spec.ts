import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { seedSandboxRow, seedUsers } from '../../../../test/session-seed'
import {
  as,
  createSandboxSelfApp,
  procedurePath,
  SANDBOX_TOKEN,
} from './sandbox-self.router.fixture'

const post = ({
  app,
  procedure,
  token,
  body,
}: {
  app: INestApplication
  procedure: string
  token: string | undefined
  body?: unknown
}) => {
  const call = request(app.getHttpServer()).post(procedurePath(procedure))
  const authed = token === undefined ? call : call.set(as(token))
  return body === undefined ? authed : authed.send(body as object)
}

const storedPaths = async (threadId: string): Promise<string[]> =>
  (await db.orm.public.ContextFile.where({ threadId }).select('path').all())
    .map((row) => row.path)
    .sort()

describe('SandboxSelfRouter context files', () => {
  useTestDatabase()
  let app: INestApplication
  const send = (procedure: string, token: string | undefined, body?: unknown) =>
    post({ app, procedure, token, body })

  beforeAll(async () => {
    app = await createSandboxSelfApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await seedUsers('usr-1')
    await seedSandboxRow({ threadId: 'thr-1', userId: 'usr-1', name: 'atlas-thread-1' })
  })

  it('requires a sandbox token', async () => {
    const reply = await send('putContextFile', undefined, { path: 'plan.md', content: 'hi' })
    expect(reply.status).toBe(401)
  })

  it('puts and updates a mirrored context file', async () => {
    const created = await send('putContextFile', SANDBOX_TOKEN, {
      path: 'plan.md',
      content: 'v1',
    })
    expect(created.status).toBe(200)

    const row = await db.orm.public.ContextFile.where({
      threadId: 'thr-1',
      path: 'plan.md',
    }).first()
    expect(row?.content).toBe('v1')
    expect(row?.digest).toMatch(/^[0-9a-f]{64}$/)

    const updated = await send('putContextFile', SANDBOX_TOKEN, {
      path: 'plan.md',
      content: 'v2',
    })
    expect(updated.status).toBe(200)
    expect(await storedPaths('thr-1')).toEqual(['plan.md'])
    const after = await db.orm.public.ContextFile.where({
      threadId: 'thr-1',
      path: 'plan.md',
    }).first()
    expect(after?.content).toBe('v2')
    expect(after?.digest).not.toBe(row?.digest)
  })

  it('refuses a thread outside the sandbox family', async () => {
    await seedUsers('usr-2')
    await seedSandboxRow({ threadId: 'thr-other', userId: 'usr-2', name: 'atlas-thread-2' })
    const reply = await send('putContextFile', SANDBOX_TOKEN, {
      threadId: 'thr-other',
      path: 'plan.md',
      content: 'nope',
    })
    expect(reply.status).toBe(403)
    expect(await storedPaths('thr-other')).toEqual([])
  })

  it('deletes a mirrored context file', async () => {
    await send('putContextFile', SANDBOX_TOKEN, { path: 'plan.md', content: 'v1' })
    await send('putContextFile', SANDBOX_TOKEN, { path: 'notes/a.md', content: 'a' })
    const reply = await send('deleteContextFile', SANDBOX_TOKEN, { path: 'plan.md' })
    expect(reply.status).toBe(200)
    expect(await storedPaths('thr-1')).toEqual(['notes/a.md'])
  })

  it('deletes every row the keep list does not name', async () => {
    await send('putContextFile', SANDBOX_TOKEN, { path: 'plan.md', content: 'v1' })
    await send('putContextFile', SANDBOX_TOKEN, { path: 'notes/a.md', content: 'a' })
    await send('putContextFile', SANDBOX_TOKEN, { path: 'notes/b.md', content: 'b' })
    const reply = await send('deleteMissingContextFiles', SANDBOX_TOKEN, {
      keep: ['notes/b.md'],
    })
    expect(reply.status).toBe(200)
    expect(await storedPaths('thr-1')).toEqual(['notes/b.md'])
  })

  it('keeps a resync from touching another thread', async () => {
    await seedUsers('usr-2')
    await seedSandboxRow({ threadId: 'thr-other', userId: 'usr-2', name: 'atlas-thread-2' })
    await send('putContextFile', SANDBOX_TOKEN, { path: 'plan.md', content: 'mine' })
    await db.orm.public.ContextFile.create({
      id: 'ctxf_other',
      threadId: 'thr-other',
      path: 'theirs.md',
      content: 'theirs',
      digest: 'x',
      updatedAt: new Date(),
    })
    const reply = await send('deleteMissingContextFiles', SANDBOX_TOKEN, { keep: [] })
    expect(reply.status).toBe(200)
    expect(await storedPaths('thr-1')).toEqual([])
    expect(await storedPaths('thr-other')).toEqual(['theirs.md'])
  })
})
