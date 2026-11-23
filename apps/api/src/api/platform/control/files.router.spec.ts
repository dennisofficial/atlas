import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { as } from '../../../_module/trpc/trpc-middleware.fixture'
import { createFilesApp, files } from './files.router.fixture'
import { PodNotReadyError } from './pod-errors'

describe('FilesRouter', () => {
  let app: NestExpressApplication

  const tree = (token: string | undefined, input: object, batch = false) =>
    request(app.getHttpServer())
      .get('/v1/trpc/files.tree')
      .set(token === undefined ? {} : as(token))
      .query({ input: JSON.stringify(input), ...(batch ? { batch: '1' } : {}) })

  const search = (args: { token: string; input: object }) =>
    request(app.getHttpServer())
      .get('/v1/trpc/files.search')
      .set(as(args.token))
      .query({ input: JSON.stringify(args.input) })

  beforeEach(async () => {
    for (const fn of Object.values(files)) fn.mockReset()
    app = await createFilesApp()
  })

  afterEach(() => app.close())

  it('rejects an unauthenticated caller with 401', async () => {
    const response = await tree(undefined, { sessionId: 's1', directory: '' })
    expect(response.status).toBe(401)
    expect(files.tree).not.toHaveBeenCalled()
  })

  it('refuses a batched call', async () => {
    const response = await tree('session-a', { sessionId: 's1', directory: '' }, true)
    expect(response.status).toBe(400)
    expect(files.tree).not.toHaveBeenCalled()
  })

  it('passes the tree through for the owner', async () => {
    const output = { directory: '', entries: [{ name: 'src', isDirectory: true, changed: false }] }
    files.tree.mockResolvedValue(output)

    const response = await tree('session-a', { sessionId: 's1', directory: '' })

    expect(response.status).toBe(200)
    expect(response.body.result.data).toEqual(output)
    expect(files.tree).toHaveBeenCalledWith({ userId: 'user-a', sessionId: 's1', directory: '' })
  })

  it('passes a checkout id through for the owner', async () => {
    const output = { directory: '', entries: [] }
    files.tree.mockResolvedValue(output)

    const response = await tree('session-a', { sessionId: 's1', directory: '', checkoutId: 'c1' })

    expect(response.status).toBe(200)
    expect(files.tree).toHaveBeenCalledWith({
      userId: 'user-a',
      sessionId: 's1',
      directory: '',
      checkoutId: 'c1',
    })
  })

  it('passes a checkout id through to search', async () => {
    files.search.mockResolvedValue({ paths: [], truncated: false })

    const response = await search({
      token: 'session-a',
      input: { sessionId: 's1', query: 'a', checkoutId: 'c1' },
    })

    expect(response.status).toBe(200)
    expect(files.search).toHaveBeenCalledWith({
      userId: 'user-a',
      sessionId: 's1',
      query: 'a',
      checkoutId: 'c1',
    })
  })

  it('answers a parked pod with PRECONDITION_FAILED', async () => {
    files.tree.mockRejectedValue(new PodNotReadyError())

    const response = await tree('session-a', { sessionId: 's1', directory: '' })

    expect(response.status).toBe(412)
    expect(JSON.stringify(response.body)).toContain('pod is asleep')
    expect(JSON.stringify(response.body)).toContain('pod-not-ready')
  })
})
