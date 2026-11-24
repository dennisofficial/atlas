import type { Db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { EMcpToken } from '@dltech/atlas-plugin-sdk'
import { describe, expect, it } from 'bun:test'

import type { McpOauthGateway } from '../../mcp-oauth'
import { mcpControlOf, offlineMacLink } from '../mcp-control'
import { cipher, sealed, seedOwner } from './config-reader.fixture'

const testDb = useTestDatabase()

const gatewayOf = (refresh: McpOauthGateway['refresh']): McpOauthGateway => ({
  begin: async () => ({ ok: false, reason: 'unused' }),
  refresh,
})

const tokenOf = async (args: { db: Db; gateway: McpOauthGateway; url: string }) =>
  await mcpControlOf({
    db: args.db,
    cipher,
    gateway: args.gateway,
    macLink: offlineMacLink,
  })
    .of('s-1')
    .token({ name: 'paper', source: 'cloud', url: args.url })

const seedGranted = async (args: {
  db: Db
  oauthServerUrl: string
  specUrl: string
  expiresAt?: string
}) => {
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
    oauthSealed: sealed({
      tokens: {
        accessToken: 'at-1',
        ...(args.expiresAt === undefined ? {} : { expiresAt: args.expiresAt }),
      },
    }),
  })
}

const PAST = '2020-01-01T00:00:00.000Z'

describe('mcpControl token', () => {
  it('carries the token when the stored url differs from the request only by a trailing slash', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedGranted({
      db,
      specUrl: 'https://mcp.paper.design',
      oauthServerUrl: 'https://mcp.paper.design/',
    })

    expect(
      await tokenOf({
        db,
        gateway: gatewayOf(async () => unreachable()),
        url: 'https://mcp.paper.design',
      }),
    ).toEqual({ kind: EMcpToken.Granted, accessToken: 'at-1' })
  })

  it('asks for a sign-in when the grant was made for another host', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedGranted({
      db,
      specUrl: 'https://mcp.example.com/mcp',
      oauthServerUrl: 'https://mcp.example.com/mcp',
    })

    expect(
      await tokenOf({
        db,
        gateway: gatewayOf(async () => unreachable()),
        url: 'https://mcp.paper.design',
      }),
    ).toEqual({ kind: EMcpToken.SignIn })
  })

  it('asks for a sign-in when no grant row matches the server', async () => {
    const { db } = testDb()
    await seedOwner(db)

    expect(
      await tokenOf({
        db,
        gateway: gatewayOf(async () => unreachable()),
        url: 'https://mcp.paper.design',
      }),
    ).toEqual({ kind: EMcpToken.SignIn })
  })

  it('reports an expired grant as unavailable while the refresh is merely in flight', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedGranted({
      db,
      specUrl: 'https://mcp.paper.design/mcp',
      oauthServerUrl: 'https://mcp.paper.design/mcp',
      expiresAt: PAST,
    })

    expect(
      await tokenOf({
        db,
        gateway: gatewayOf(async () => ({
          ok: false,
          reason: 'another refresh is in flight; retry shortly',
        })),
        url: 'https://mcp.paper.design/mcp',
      }),
    ).toEqual({
      kind: EMcpToken.Unavailable,
      reason: 'another refresh is in flight; retry shortly',
    })
  })

  it('reports a real sign-out as a sign-in', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedGranted({
      db,
      specUrl: 'https://mcp.paper.design/mcp',
      oauthServerUrl: 'https://mcp.paper.design/mcp',
      expiresAt: PAST,
    })

    expect(
      await tokenOf({
        db,
        gateway: gatewayOf(async () => ({
          ok: false,
          reason: 'the server has no usable grant; sign in again',
          signIn: true,
        })),
        url: 'https://mcp.paper.design/mcp',
      }),
    ).toEqual({ kind: EMcpToken.SignIn })
  })

  it('reports a refresh that handed back a token as granted', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedGranted({
      db,
      specUrl: 'https://mcp.paper.design/mcp',
      oauthServerUrl: 'https://mcp.paper.design/mcp',
      expiresAt: PAST,
    })

    expect(
      await tokenOf({
        db,
        gateway: gatewayOf(async () => ({
          ok: true,
          accessToken: 'at-2',
          expiresAt: null,
        })),
        url: 'https://mcp.paper.design/mcp',
      }),
    ).toEqual({ kind: EMcpToken.Granted, accessToken: 'at-2' })
  })

  it('reports a thrown refresh as unavailable, never as a sign-out', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedGranted({
      db,
      specUrl: 'https://mcp.paper.design/mcp',
      oauthServerUrl: 'https://mcp.paper.design/mcp',
      expiresAt: PAST,
    })

    expect(
      await tokenOf({
        db,
        gateway: gatewayOf(async () => {
          throw new Error('the connection dropped')
        }),
        url: 'https://mcp.paper.design/mcp',
      }),
    ).toEqual({ kind: EMcpToken.Unavailable, reason: 'the connection dropped' })
  })
})

function unreachable(): never {
  throw new Error('this case reads a fresh grant')
}
