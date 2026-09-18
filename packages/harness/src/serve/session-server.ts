import type { Server } from 'bun'

import { CHANNEL_SUBPROTOCOL, tokenFromSubprotocols } from '../cloud/channel-wire'

import type { SessionHandlers, SocketState } from './socket-session'
import { bearerToken, offeredSubprotocols, tokenMatches } from './token-guard'

export const HEALTH_PATH = '/v1/health'

export const SESSION_PATH = '/v1/session'

const MAX_IDLE_SECONDS = 255

const unauthorized = (): Response => new Response('unauthorized', { status: 401 })

export function startSessionServer(args: {
  port: number
  token: string
  handlers: SessionHandlers
  health: () => unknown
}): Server<SocketState> {
  const { token, handlers } = args

  return Bun.serve<SocketState, never>({
    port: args.port,

    fetch(request, server) {
      const { pathname } = new URL(request.url)

      if (pathname === HEALTH_PATH) {
        if (request.method !== 'GET') return new Response('method not allowed', { status: 405 })
        const offered = bearerToken(request.headers.get('authorization'))
        if (!tokenMatches({ expected: token, offered })) return unauthorized()
        return Response.json(args.health())
      }

      if (pathname !== SESSION_PATH) return new Response('not found', { status: 404 })

      const offered = offeredSubprotocols(request.headers.get('sec-websocket-protocol'))
      if (!offered.includes(CHANNEL_SUBPROTOCOL)) {
        return new Response(`expected the ${CHANNEL_SUBPROTOCOL} subprotocol`, { status: 400 })
      }
      if (!tokenMatches({ expected: token, offered: tokenFromSubprotocols(offered) })) {
        return unauthorized()
      }

      const upgraded = server.upgrade(request, {
        data: { helloed: false, alias: null },
        headers: { 'Sec-WebSocket-Protocol': CHANNEL_SUBPROTOCOL },
      })

      return upgraded ? undefined : new Response('expected a websocket upgrade', { status: 426 })
    },

    websocket: {
      /** A parked client is attached and silent for as long as it likes: pings keep it, and only it, honest. */
      sendPings: true,
      idleTimeout: MAX_IDLE_SECONDS,
      open: (socket) => handlers.open({ socket }),
      message: (socket, message) => handlers.message({ socket, message }),
      close: (socket) => handlers.close({ socket }),
    },
  })
}
