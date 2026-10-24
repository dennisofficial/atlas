import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { INestApplication } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createPersonalApp, trpcMutate, trpcQuery } from '../personal-resources.router.fixture'
import { seedSessionUsers } from '../web-settings.fake-db'
import { McpServersRouter } from './mcp-servers.router'
import { McpServersService } from './mcp-servers.service'

describe('McpServersRouter', () => {
  useTestDatabase()
  const servers = () => db.orm.public.UserMcpServer.where((row) => row.id.neq('')).all()
  let app: INestApplication
  const put = (input: object, token = 'session-a') =>
    trpcMutate({ app, procedure: 'mcpServers.put', token, input })

  beforeEach(async () => {
    await seedSessionUsers()
    app = await createPersonalApp([McpServersRouter, McpServersService])
  })

  afterEach(() => app.close())

  it('accepts a well-formed stdio spec and lists it back', async () => {
    await put({
      name: 'fs',
      transport: { kind: 'stdio', command: 'npx', args: ['-y', 'srv'] },
    }).expect(200)

    const listed = await trpcQuery({
      app,
      procedure: 'mcpServers.list',
      token: 'session-a',
    }).expect(200)
    expect(listed.headers['cache-control']).toBe('no-store')
    expect(listed.body.result.data.servers).toEqual([
      {
        name: 'fs',
        transport: { kind: 'stdio', command: 'npx', args: ['-y', 'srv'] },
        updatedAt: expect.any(String),
      },
    ])
  })

  it('accepts a disabled server with no transport', async () => {
    await put({ name: 'paused', disabled: true }).expect(200)
  })

  it('rejects an unknown property', async () => {
    await put({ name: 'fs', transport: { kind: 'stdio', command: 'npx' }, bogus: true }).expect(400)
  })

  it('rejects an unknown transport property', async () => {
    await put({ name: 'fs', transport: { kind: 'stdio', command: 'npx', bogus: true } }).expect(400)
  })

  it('rejects a transport kind outside the union', async () => {
    await put({ name: 'fs', transport: { kind: 'sse', url: 'https://mcp.example.com' } }).expect(
      400,
    )
  })

  it('rejects a transport that is not an object', async () => {
    await put({ name: 'fs', transport: 'stdio' }).expect(400)
  })

  it('rejects a spec with neither transport nor disabled', async () => {
    await put({ name: 'empty' }).expect(400)
    await put({ name: 'empty', trusted: true }).expect(400)
    expect(await servers()).toHaveLength(0)
  })

  it('removes only the caller’s server', async () => {
    await put({ name: 'fs', disabled: true }).expect(200)
    await put({ name: 'fs', disabled: true }, 'session-b').expect(200)

    const removed = await trpcMutate({
      app,
      procedure: 'mcpServers.remove',
      token: 'session-a',
      input: { name: 'fs' },
    }).expect(200)

    expect(removed.body).toEqual({ result: {} })
    expect((await servers()).map((row) => row.userId)).toEqual(['user-b'])
  })

  it('requires a session on every procedure', async () => {
    await trpcQuery({ app, procedure: 'mcpServers.list' }).expect(401)
    await trpcQuery({ app, procedure: 'mcpServers.list', token: 'pod-token-a' }).expect(401)
    await put({ name: 'fs', disabled: true }, 'sandbox-token-a').expect(401)
    await trpcMutate({ app, procedure: 'mcpServers.remove', input: { name: 'fs' } }).expect(401)
  })
})
