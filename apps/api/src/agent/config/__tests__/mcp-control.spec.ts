import type { Db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'

import type { McpOauthGateway } from '../../mcp-oauth'
import { mcpControlOf } from '../mcp-control'
import { cipher, sealed, seedOwner } from './config-reader.fixture'

const testDb = useTestDatabase()

const gatewayOf = (): McpOauthGateway => ({
  begin: async () => ({ ok: false, reason: 'unused' }),
  refresh: async () => ({ ok: false, reason: 'unused' }),
})

const tokenOf = async (args: { db: Db; url: string }): Promise<string | undefined> =>
  await mcpControlOf({ db: args.db, cipher, gateway: gatewayOf() })
    .of('s-1')
    .token({ name: 'paper', source: 'cloud', url: args.url })

const seedGranted = async (args: { db: Db; oauthServerUrl: string; specUrl: string }) => {
  await args.db.orm.public.McpServer.create({
    id: 'srv-paper',
    name: 'paper',
    source: 'cloud',
    sealedSpec: sealed({
      name: 'paper',
      transport: { kind: 'http', url: args.specUrl },
    }),
    userId: 'user-1',
    oauthStatus: 'active',
    oauthServerUrl: args.oauthServerUrl,
    oauthSealed: sealed({ tokens: { accessToken: 'at-1' } }),
  })
}

describe('mcpControl token', () => {
  it('carries the token when the stored url differs from the request only by a trailing slash', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedGranted({
      db,
      specUrl: 'https://mcp.paper.design',
      oauthServerUrl: 'https://mcp.paper.design/',
    })

    expect(await tokenOf({ db, url: 'https://mcp.paper.design' })).toBe('at-1')
  })

  it('leaves a grant made for another host without a token', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedGranted({
      db,
      specUrl: 'https://mcp.example.com/mcp',
      oauthServerUrl: 'https://mcp.example.com/mcp',
    })

    expect(await tokenOf({ db, url: 'https://mcp.paper.design' })).toBeUndefined()
  })
})
