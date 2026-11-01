import { afterEach, describe, expect, it } from 'bun:test'

import { bearerSubprotocolOf, CHANNEL_SUBPROTOCOL, mintChannelTicket } from '@dltech/atlas-wire'

import { HEALTH_PATH, startSessionServer } from '../session-server'

const TOKEN = 'serve-token'
const THREAD = 'thread-a'

const servers: { stop: (force: boolean) => unknown }[] = []

afterEach(() => {
  for (const server of servers.splice(0)) void server.stop(true)
})

const serverOnFreePort = (): { port: number } => {
  const { server } = startSessionServer({
    port: 0,
    token: TOKEN,
    threadId: THREAD,
    handlers: () => undefined,
    drain: () => undefined,
    health: () => ({ ok: true }),
  })
  servers.push(server)
  return { port: server.port ?? 0 }
}

const ticketFor = (args: { threadId?: string; ttlSeconds?: number }): string =>
  mintChannelTicket({
    serveToken: TOKEN,
    threadId: args.threadId ?? THREAD,
    ttlSeconds: args.ttlSeconds ?? 60,
    nowMs: Date.now(),
  }).ticket

const upgradeStatus = async (args: { port: number; credential: string }): Promise<number> => {
  const response = await fetch(`http://127.0.0.1:${args.port}/v1/session`, {
    headers: {
      connection: 'Upgrade',
      upgrade: 'websocket',
      'sec-websocket-version': '13',
      'sec-websocket-key': Buffer.from('0123456789abcdef').toString('base64'),
      'sec-websocket-protocol': `${CHANNEL_SUBPROTOCOL}, ${bearerSubprotocolOf(args.credential)}`,
    },
  })
  return response.status
}

const opens = (args: { port: number; credential: string }): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${args.port}/v1/session`, [
      CHANNEL_SUBPROTOCOL,
      bearerSubprotocolOf(args.credential),
    ])
    socket.addEventListener('open', () => {
      socket.close()
      resolve(true)
    })
    socket.addEventListener('error', () => resolve(false))
  })

describe('session server channel tickets', () => {
  it('upgrades a valid ticket', async () => {
    const { port } = serverOnFreePort()

    expect(await opens({ port, credential: ticketFor({}) })).toBe(true)
  })

  it('still upgrades the raw serve token', async () => {
    const { port } = serverOnFreePort()

    expect(await opens({ port, credential: TOKEN })).toBe(true)
  })

  it('refuses an expired ticket with 401', async () => {
    const { port } = serverOnFreePort()

    expect(await upgradeStatus({ port, credential: ticketFor({ ttlSeconds: -1 }) })).toBe(401)
  })

  it('refuses a ticket minted for another thread with 401', async () => {
    const { port } = serverOnFreePort()

    expect(await upgradeStatus({ port, credential: ticketFor({ threadId: 'thread-b' }) })).toBe(401)
  })

  it('refuses garbage with 401', async () => {
    const { port } = serverOnFreePort()

    expect(await upgradeStatus({ port, credential: 'ct1.x.y' })).toBe(401)
  })

  it('refuses a ticket as the bearer on /v1/health, and answers the raw token', async () => {
    const { port } = serverOnFreePort()
    const url = `http://127.0.0.1:${port}${HEALTH_PATH}`

    const withTicket = await fetch(url, { headers: { authorization: `Bearer ${ticketFor({})}` } })
    const withToken = await fetch(url, { headers: { authorization: `Bearer ${TOKEN}` } })

    expect(withTicket.status).toBe(401)
    expect(withToken.status).toBe(200)
  })
})

describe('family admission', () => {
  const serverWithFamily = (args: {
    handlers: boolean
    admitsThread: (threadId: string) => Promise<boolean>
  }): { port: number } => {
    const { server } = startSessionServer({
      port: 0,
      token: TOKEN,
      threadId: THREAD,
      handlers: () =>
        args.handlers
          ? ({
              open: () => undefined,
              message: () => undefined,
              close: () => undefined,
              broadcast: () => undefined,
              replayDeferred: () => undefined,
              broadcastRoster: () => undefined,
              broadcastPrStates: () => undefined,
              broadcastSubscriptions: () => undefined,
              park: () => undefined,
              hangUp: () => undefined,
              abortHistory: () => undefined,
              clients: () => 0,
              settling: () => false,
              whenSettled: async () => undefined,
            } as never)
          : undefined,
      drain: () => undefined,
      health: () => ({ ok: true }),
      admitsThread: args.admitsThread,
    })
    servers.push(server)
    return { port: server.port ?? 0 }
  }

  it('admits a ticket minted for a family thread once booted', async () => {
    const { port } = serverWithFamily({
      handlers: true,
      admitsThread: async (asked) => asked === 'thread-child',
    })

    expect(await opens({ port, credential: ticketFor({ threadId: 'thread-child' }) })).toBe(true)
  })

  it('refuses a ticket naming a thread outside the family once booted', async () => {
    const { port } = serverWithFamily({
      handlers: true,
      admitsThread: async (asked) => asked === 'thread-child',
    })

    expect(await upgradeStatus({ port, credential: ticketFor({ threadId: 'thread-b' }) })).toBe(401)
  })

  it('admits a well-formed ticket without consulting the family while booting', async () => {
    const asked: string[] = []
    const { port } = serverWithFamily({
      handlers: false,
      admitsThread: async (thread) => (asked.push(thread), false),
    })

    expect(await upgradeStatus({ port, credential: ticketFor({ threadId: 'thread-child' }) })).toBe(
      101,
    )
    expect(asked).toEqual([])
  })
})
