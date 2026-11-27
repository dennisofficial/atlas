import type { Db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { EMcpToken } from '@dltech/atlas-plugin-sdk'
import { describe, expect, it } from 'bun:test'

import type { McpOauthGateway } from '../../mcp-oauth'
import { mcpControlOf, offlineMacLink } from '../mcp-control'
import { cipher, sealed, seedOwner } from './config-reader.fixture'

const testDb = useTestDatabase()

const REFUSED_AT = new Date('2026-11-20T12:00:00.000Z')

const unreachable: McpOauthGateway['refresh'] = async () => {
  throw new Error('this case reads no grant')
}

const tokenOf = async (args: { db: Db; url: string }) =>
  await mcpControlOf({
    db: args.db,
    cipher,
    gateway: { begin: async () => ({ ok: false, reason: 'unused' }), refresh: unreachable },
    macLink: offlineMacLink,
  })
    .of('s-1')
    .token({ name: 'paper', source: 'cloud', url: args.url })

const seedRefused = async (args: {
  db: Db
  id: string
  projectId?: string
  specUrl: string
  refusal?: string
}): Promise<void> => {
  await args.db.orm.public.McpServer.create({
    id: args.id,
    name: 'paper',
    source: 'cloud',
    sealedSpec: sealed({ name: 'paper', transport: { kind: 'http', url: args.specUrl } }),
    ...(args.projectId === undefined ? { userId: 'user-1' } : { projectId: args.projectId }),
    ...(args.refusal === undefined
      ? {}
      : { oauthRefusal: args.refusal, oauthRefusedAt: REFUSED_AT }),
  })
}

describe('mcpControl refusal', () => {
  it('reports the refusal of the row that matches the requested url, not another scope', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedRefused({
      db,
      id: 'srv-user',
      specUrl: 'https://mcp.other.design/mcp',
      refusal: 'mcp.other.design answered: access_denied',
    })
    await seedRefused({
      db,
      id: 'srv-project',
      projectId: 'proj-1',
      specUrl: 'https://mcp.paper.design/mcp',
      refusal: 'mcp.paper.design answered: access_denied',
    })

    expect(await tokenOf({ db, url: 'https://mcp.paper.design/mcp' })).toEqual({
      kind: EMcpToken.Refused,
      reason: 'mcp.paper.design answered: access_denied',
    })
  })

  it('ignores a refusal another scope holds for the same name at a different url', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedRefused({
      db,
      id: 'srv-user',
      specUrl: 'https://mcp.other.design/mcp',
      refusal: 'mcp.other.design answered: access_denied',
    })
    await seedRefused({
      db,
      id: 'srv-project',
      projectId: 'proj-1',
      specUrl: 'https://mcp.paper.design/mcp',
    })

    expect(await tokenOf({ db, url: 'https://mcp.paper.design/mcp' })).toEqual({
      kind: EMcpToken.SignIn,
    })
  })
})
