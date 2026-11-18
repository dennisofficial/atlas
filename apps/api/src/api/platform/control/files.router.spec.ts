import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { as } from '../../../_module/trpc/trpc-middleware.fixture'
import { createFilesApp, files } from './files.router.fixture'
import { PodParkedError } from './pod-parked.error'

describe('FilesRouter', () => {
  let app: NestExpressApplication

  const tree = (token: string | undefined, input: object, batch = false) =>
    request(app.getHttpServer())
      .get('/v1/trpc/files.tree')
      .set(token === undefined ? {} : as(token))
      .query({ input: JSON.stringify(input), ...(batch ? { batch: '1' } : {}) })

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

  it('answers a parked pod with PRECONDITION_FAILED', async () => {
    files.tree.mockRejectedValue(new PodParkedError())

    const response = await tree('session-a', { sessionId: 's1', directory: '' })

    expect(response.status).toBe(412)
    expect(JSON.stringify(response.body)).toContain('pod is asleep')
  })
})
