import type { Server } from 'bun'

import { CHANNEL_SUBPROTOCOL, tokenFromSubprotocols } from '@dltech/atlas-harness'

import type { ServeDrain } from './serve-drain'
import type { SessionHandlers, SessionSocket, SocketState } from './socket-session'
import { bearerToken, offeredSubprotocols, tokenMatches } from './token-guard'

export const HEALTH_PATH = '/v1/health'

export const PARK_PATH = '/v1/park'

export const DRAIN_PATH = '/v1/drain'

export const SESSION_PATH = '/v1/session'

const MAX_IDLE_SECONDS = 255

const BOOT_FAILED_CLOSE = 1011

const unauthorized = (): Response => new Response('unauthorized', { status: 401 })

const booting = (): Response => new Response('serve is still booting', { status: 503 })

const reasonOf = async (request: Request): Promise<string | null> => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null) return null
  const reason = (body as { reason?: unknown }).reason
  return typeof reason === 'string' && reason.length > 0 ? reason : null
}

const reasonedPost = async (args: { request: Request; token: string }): Promise<string | Response> => {
  if (args.request.method !== 'POST') return new Response('method not allowed', { status: 405 })
  const offered = bearerToken(args.request.headers.get('authorization'))
  if (!tokenMatches({ expected: args.token, offered })) return unauthorized()
  const reason = await reasonOf(args.request)
  return reason ?? new Response('a reason is required', { status: 400 })
}

export type SessionServerHandshake = {
  hold: (socket: SessionSocket) => boolean
  flush: (args: { handlers: SessionHandlers }) => void
  drop: (args: { reason: string }) => void
}

export function startSessionServer(args: {
  port: number
  token: string
  handlers: () => SessionHandlers | undefined
  drain: () => ServeDrain | undefined
  health: () => unknown
}): { server: Server<SocketState>; handshake: SessionServerHandshake } {
  const { token } = args
  const held = new Set<SessionSocket>()
  let bootFailure: string | null = null

  const dropHeld = (args: { reason: string }): void => {
    bootFailure = args.reason
    for (const socket of [...held]) {
      held.delete(socket)
      socket.send(JSON.stringify({ kind: 'error', message: `the serve could not boot: ${args.reason}` }))
      socket.close(BOOT_FAILED_CLOSE, 'the serve could not boot')
    }
  }

  const handshake: SessionServerHandshake = {
    hold: (socket) => {
      if (bootFailure !== null) return false
      held.add(socket)
      return true
    },
    flush: ({ handlers }) => {
      for (const socket of [...held]) {
        held.delete(socket)
        handlers.open({ socket })
      }
    },
    drop: dropHeld,
  }

  const server = Bun.serve<SocketState, never>({
    port: args.port,

    async fetch(request, server) {
      const { pathname } = new URL(request.url)

      if (pathname === HEALTH_PATH) {
        if (request.method !== 'GET') return new Response('method not allowed', { status: 405 })
        const offered = bearerToken(request.headers.get('authorization'))
        if (!tokenMatches({ expected: token, offered })) return unauthorized()
        return Response.json(args.health())
      }

      if (pathname === PARK_PATH) {
        const handlers = args.handlers()
        if (handlers === undefined) return booting()
        const reason = await reasonedPost({ request, token })
        if (reason instanceof Response) return reason
        handlers.park({ reason })
        return Response.json({ ok: true })
      }

      if (pathname === DRAIN_PATH) {
        const drain = args.drain()
        if (drain === undefined) return booting()
        const reason = await reasonedPost({ request, token })
        if (reason instanceof Response) return reason
        try {
          return Response.json(await drain({ reason }))
        } catch (failure) {
          return Response.json({
            ok: false,
            message: failure instanceof Error ? failure.message : String(failure),
          }, { status: 503 })
        }
      }

      if (pathname !== SESSION_PATH) return new Response('not found', { status: 404 })

      const offered = offeredSubprotocols(request.headers.get('sec-websocket-protocol'))
      if (!offered.includes(CHANNEL_SUBPROTOCOL)) {
        return new Response(`expected the ${CHANNEL_SUBPROTOCOL} subprotocol`, { status: 400 })
      }
      if (!tokenMatches({ expected: token, offered: tokenFromSubprotocols(offered) })) {
        return unauthorized()
      }
      if (bootFailure !== null) return booting()

      const upgraded = server.upgrade(request, {
        data: { helloed: false, alias: null, greeting: 0, greeted: false, held: [], bootHeld: [] },
        headers: { 'Sec-WebSocket-Protocol': CHANNEL_SUBPROTOCOL },
      })

      return upgraded ? undefined : new Response('expected a websocket upgrade', { status: 426 })
    },

    websocket: {
      /** A parked client is attached and silent for as long as it likes: pings keep it, and only it, honest. */
      sendPings: true,
      idleTimeout: MAX_IDLE_SECONDS,
      open: (socket) => {
        const handlers = args.handlers()
        if (handlers === undefined) {
          if (!handshake.hold(socket)) socket.close(BOOT_FAILED_CLOSE, 'the serve could not boot')
          return
        }
        handlers.open({ socket })
      },
      message: (socket, message) => {
        if (held.has(socket)) {
          socket.data.bootHeld.push(typeof message === 'string' ? message : message.toString())
          return
        }
        args.handlers()?.message({ socket, message })
      },
      close: (socket) => {
        held.delete(socket)
        args.handlers()?.close({ socket })
      },
    },
  })

  return { server, handshake }
}
