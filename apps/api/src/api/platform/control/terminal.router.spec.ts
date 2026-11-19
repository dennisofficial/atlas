import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { as } from '../../../_module/trpc/trpc-middleware.fixture'
import { PodParkedError } from './pod-parked.error'
import { createTerminalApp, terminals } from './terminal.router.fixture'

describe('TerminalRouter', () => {
  let app: NestExpressApplication

  const query = (args: {
    path: string
    token?: string | undefined
    input: object
    batch?: boolean
  }) =>
    request(app.getHttpServer())
      .get(`/v1/trpc/${args.path}`)
      .set(args.token === undefined ? {} : as(args.token))
      .query({
        input: JSON.stringify(args.input),
        ...(args.batch === true ? { batch: '1' } : {}),
      })

  const mutate = (args: {
    path: string
    token?: string | undefined
    input: object
    batch?: boolean
  }) =>
    request(app.getHttpServer())
      .post(`/v1/trpc/${args.path}`)
      .set(args.token === undefined ? {} : as(args.token))
      .send(args.input)
      .query(args.batch === true ? { batch: '1' } : {})

  beforeEach(async () => {
    for (const fn of Object.values(terminals)) fn.mockReset()
    app = await createTerminalApp()
  })

  afterEach(() => app.close())

  it('rejects an unauthenticated caller with 401', async () => {
    const response = await query({ path: 'terminal.list', input: { sessionId: 's1' } })
    expect(response.status).toBe(401)
    expect(terminals.list).not.toHaveBeenCalled()
  })

  it('refuses a batched pod call', async () => {
    const response = await mutate({
      path: 'terminal.open',
      token: 'session-a',
      input: { sessionId: 's1', cols: 80, rows: 24 },
      batch: true,
    })
    expect(response.status).toBe(400)
    expect(terminals.open).not.toHaveBeenCalled()
  })

  it('passes the owner through to the service', async () => {
    terminals.list.mockResolvedValue({ terminals: [] })
    const response = await query({
      path: 'terminal.list',
      token: 'session-a',
      input: { sessionId: 's1' },
    })
    expect(response.status).toBe(200)
    expect(terminals.list).toHaveBeenCalledWith({ userId: 'user-a', sessionId: 's1' })
  })

  it('answers a parked pod with PRECONDITION_FAILED', async () => {
    terminals.read.mockRejectedValue(new PodParkedError())
    const response = await query({
      path: 'terminal.read',
      token: 'session-a',
      input: { sessionId: 's1', terminalId: 't1', offset: 0 },
    })
    expect(response.status).toBe(412)
    expect(JSON.stringify(response.body)).toContain('pod is asleep')
  })

  it('rejects an empty rename', async () => {
    const response = await mutate({
      path: 'terminal.rename',
      token: 'session-a',
      input: { sessionId: 's1', terminalId: 't1', name: '  ' },
    })
    expect(response.status).toBe(400)
    expect(terminals.rename).not.toHaveBeenCalled()
  })
})
