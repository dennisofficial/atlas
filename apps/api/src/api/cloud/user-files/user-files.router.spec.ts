import { createHash } from 'node:crypto'
import type { INestApplication } from '@nestjs/common'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { buildSessionTrpcApp, dataOf, trpcMutation, trpcQuery } from '../session-trpc-test-app'
import { seedSessionUsers } from '../web-settings.fake-db'
import { UserFilesRouter } from './user-files.router'
import { UserFilesService } from './user-files.service'

const SANDBOX_TOKENS = { 'sandbox-a': { threadId: 'thread-sbx-a', userId: 'user-a' } }
const POD_TOKENS = { 'pod-a': { threadId: 'thread-pod-a', userId: 'user-a' } }

const encode = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
const hashOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const fileOf = (text: string) => {
  const bytes = new TextEncoder().encode(text)
  return { content: encode(bytes), contentHash: hashOf(bytes) }
}

describe('UserFilesRouter', () => {
  useTestDatabase()
  let app: INestApplication
  const put = (token: string | undefined, input: Record<string, unknown>) =>
    trpcMutation({ app, path: 'userFiles.put', token, input })
  const list = (token: string | undefined, input: Record<string, unknown>) =>
    trpcQuery({ app, path: 'userFiles.list', token, input })

  beforeAll(async () => {
    app = await buildSessionTrpcApp({
      sandboxTokens: SANDBOX_TOKENS,
      podTokens: POD_TOKENS,
      providers: [UserFilesRouter, UserFilesService],
    })
  })

  afterAll(() => app.close())

  beforeEach(async () => {
    await seedSessionUsers()
  })

  it('puts, lists, gets and removes a nested path for the session user', async () => {
    const written = await put('session-a', {
      tree: 'skills',
      path: 'review/SKILL.md',
      ...fileOf('one'),
    }).expect(200)
    expect(dataOf(written.body)).toEqual({ revision: 1 })

    const listed = await list('session-a', { tree: 'skills' }).expect(200)
    expect(dataOf(listed.body)).toMatchObject({
      files: [{ path: 'review/SKILL.md', revision: 1, tombstonedAt: null }],
    })
    const newer = await list('session-a', { tree: 'skills', sinceRevision: 1 }).expect(200)
    expect(dataOf(newer.body)).toEqual({ files: [] })

    const got = await trpcMutation({
      app,
      path: 'userFiles.get',
      token: 'session-a',
      input: { tree: 'skills', paths: ['review/SKILL.md'] },
    }).expect(200)
    expect(dataOf(got.body)).toMatchObject({ files: [{ content: fileOf('one').content }] })

    const removed = await trpcMutation({
      app,
      path: 'userFiles.remove',
      token: 'session-a',
      input: { tree: 'skills', path: 'review/SKILL.md', baseRevision: 1 },
    }).expect(200)
    expect(dataOf(removed.body)).toEqual({ revision: 2 })
  })

  it('scopes every call to the authenticated user, never a client-supplied one', async () => {
    await put('session-a', {
      tree: 'skills',
      path: 'a.md',
      userId: 'user-b',
      ...fileOf('a'),
    }).expect(200)

    expect(dataOf((await list('session-b', { tree: 'skills' }).expect(200)).body)).toEqual({
      files: [],
    })
    expect(dataOf((await list('session-a', { tree: 'skills' }).expect(200)).body)).toMatchObject({
      files: [{ path: 'a.md' }],
    })
  })

  it('reaches a sandbox token for its own user and refuses a pod lease token', async () => {
    await put('session-a', { tree: 'memory', path: 'm.md', ...fileOf('m') }).expect(200)

    const sandbox = await list('sandbox-a', { tree: 'memory' }).expect(200)
    expect(dataOf(sandbox.body)).toMatchObject({ files: [{ path: 'm.md' }] })
    await list('pod-a', { tree: 'memory' }).expect(403)
    await list(undefined, { tree: 'memory' }).expect(401)
  })

  it('answers 409 when the base revision is stale', async () => {
    await put('session-a', { tree: 'skills', path: 'c.md', ...fileOf('c') }).expect(200)

    await put('session-a', {
      tree: 'skills',
      path: 'c.md',
      baseRevision: 0,
      ...fileOf('d'),
    }).expect(409)
  })

  it('validates the input', async () => {
    await list('session-a', { tree: 'nope' }).expect(400)
    await list('session-a', { tree: 'skills', sinceRevision: -1 }).expect(400)
    await trpcMutation({
      app,
      path: 'userFiles.get',
      token: 'session-a',
      input: { tree: 'skills', paths: [] },
    }).expect(400)
    await put('session-a', { tree: 'skills', path: '../x', ...fileOf('x') }).expect(400)
    await trpcMutation({
      app,
      path: 'userFiles.remove',
      token: 'session-a',
      input: { tree: 'skills', path: 'x' },
    }).expect(400)
  })
})
