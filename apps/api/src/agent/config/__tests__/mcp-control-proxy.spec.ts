import type { Db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { MacOfflineError, type PodMcpProxyMessage } from '@dltech/atlas-plugin-sdk'
import { describe, expect, it } from 'bun:test'

import {
  MacOfflineError as MacLinkOfflineError,
  type MacChannel,
  type MacLink,
  type MacOpenArgs,
} from '../../mac-link/port'
import type { McpOauthGateway } from '../../mcp-oauth'
import { mcpControlOf } from '../mcp-control'
import { cipher, seedOwner } from './config-reader.fixture'

const testDb = useTestDatabase()

const stdio = { kind: 'stdio' as const, command: 'paper' }

const gatewayOf = (): McpOauthGateway => ({
  begin: async () => ({ ok: false, reason: 'unused' }),
  refresh: async () => ({ ok: false, reason: 'unused' }),
})

const channelOf = () => {
  const sent: PodMcpProxyMessage[] = []
  const channel: MacChannel = {
    send: (message) => void sent.push(message),
    onMessage: () => undefined,
    onClosed: () => undefined,
    close: () => undefined,
  }
  return { channel, sent }
}

const linkOf = (args: { online: boolean; channel: MacChannel; opens: MacOpenArgs[] }): MacLink => ({
  online: async () => args.online,
  open: async (openArgs) => {
    args.opens.push(openArgs)
    return args.channel
  },
})

const portOf = (args: { db: Db; macLink: MacLink }) =>
  mcpControlOf({ db: args.db, cipher, gateway: gatewayOf(), macLink: args.macLink })

const proxyOf = (args: { db: Db; macLink: MacLink }) =>
  portOf(args).of('s-1').proxy({ name: 'paper', transport: stdio, waitMs: 10_000 })

describe('mcpControl proxy', () => {
  it('reports the Mac offline without asking it to open anything', async () => {
    const { db } = testDb()
    await seedOwner(db)
    const opens: MacOpenArgs[] = []

    const outcome = await proxyOf({
      db,
      macLink: linkOf({ online: false, channel: channelOf().channel, opens }),
    }).catch((error: unknown) => error)

    expect(outcome).toBeInstanceOf(MacOfflineError)
    expect((outcome as Error).message).toBe('Mac app offline')
    expect(opens).toEqual([])
  })

  it('opens a channel for the session owner and forwards what the plugin sends', async () => {
    const { db } = testDb()
    await seedOwner(db)
    const opens: MacOpenArgs[] = []
    const { channel, sent } = channelOf()

    const proxied = await proxyOf({
      db,
      macLink: linkOf({ online: true, channel, opens }),
    })
    proxied.send({ jsonrpc: '2.0', method: 'tools/list' })

    expect(sent).toEqual([{ jsonrpc: '2.0', method: 'tools/list' }])
    expect(opens).toEqual([
      { userId: 'user-1', server: { name: 'paper', transport: stdio }, waitMs: 10_000 },
    ])
  })

  it('reports the Mac offline when the open itself times out', async () => {
    const { db } = testDb()
    await seedOwner(db)
    const macLink: MacLink = {
      online: async () => true,
      open: async () => {
        throw new MacLinkOfflineError(10_000)
      },
    }

    const outcome = await proxyOf({ db, macLink }).catch((error: unknown) => error)

    expect(outcome).toBeInstanceOf(MacOfflineError)
  })
})
