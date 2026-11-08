import type { Server } from 'bun'

import type { HostTimers } from '@dltech/atlas-host'
import type { LogPort } from '@dltech/atlas-observability'

import type { StreamAuthPort } from './stream-auth'
import { StreamConnection, type StreamSocketData } from './stream-connection'
import {
  EStreamServerClose,
  STREAM_DRAIN_RECONNECT_SPREAD_MS,
  STREAM_DRAIN_TIMEOUT_MS,
  STREAM_MAX_CONNECTIONS_PER_USER,
  STREAM_SOCKET_IDLE_SECONDS,
  STREAM_SOCKET_MAX_PAYLOAD_BYTES,
} from './stream-limits'
import { unimplementedSubscriptions, type SubscriptionPort } from './subscription-port'
import { systemHostTimers } from './system-timers'
import { createUserSlots } from './user-slots'

export type StreamServer = {
  port: number
  connections(): number
  drain(args: { reconnectAfterMs?: number }): Promise<void>
  stop(): Promise<void>
}

export type StreamServerArgs = {
  port: number
  auth: StreamAuthPort
  trustedOrigins: readonly string[]
  maxConnectionsPerUser?: number
  subscriptions?: SubscriptionPort
  timers?: HostTimers
  log?: LogPort
}

const isUpgrade = (request: Request): boolean =>
  request.headers.get('upgrade')?.toLowerCase() === 'websocket'

const originAllowed = (args: { request: Request; trusted: readonly string[] }): boolean => {
  if (args.trusted.length === 0) return true
  const origin = args.request.headers.get('origin')
  return origin === null || args.trusted.includes(origin)
}

export const startStreamServer = (args: StreamServerArgs): StreamServer => {
  const timers = args.timers ?? systemHostTimers
  const subscriptions = args.subscriptions ?? unimplementedSubscriptions
  const users = createUserSlots({
    limit: args.maxConnectionsPerUser ?? STREAM_MAX_CONNECTIONS_PER_USER,
  })
  const open = new Set<StreamConnection>()
  let draining = false
  let emptied: (() => void) | undefined

  const handleConnectionClosed = (connection: StreamConnection): void => {
    open.delete(connection)
    if (open.size === 0) emptied?.()
  }

  const server: Server<StreamSocketData> = Bun.serve<StreamSocketData>({
    port: args.port,
    fetch: (request, bunServer) => {
      const { pathname } = new URL(request.url)
      if (pathname === '/healthz' && request.method === 'GET') {
        return Response.json(
          { ok: !draining, connections: open.size },
          { status: draining ? 503 : 200 },
        )
      }
      if (pathname !== '/stream') return new Response('not found', { status: 404 })
      if (!isUpgrade(request)) return new Response('upgrade required', { status: 426 })
      if (draining) return new Response('draining', { status: 503 })
      if (!originAllowed({ request, trusted: args.trustedOrigins })) {
        return new Response('forbidden', { status: 403 })
      }
      const upgraded = bunServer.upgrade(request, { data: { connection: undefined } })
      return upgraded ? undefined : new Response('upgrade required', { status: 426 })
    },
    websocket: {
      sendPings: true,
      idleTimeout: STREAM_SOCKET_IDLE_SECONDS,
      maxPayloadLength: STREAM_SOCKET_MAX_PAYLOAD_BYTES,
      open: (socket) => {
        const connection = new StreamConnection(socket, {
          auth: args.auth,
          subscriptions,
          timers,
          users,
          log: args.log,
          onClosed: handleConnectionClosed,
        })
        socket.data.connection = connection
        open.add(connection)
      },
      message: (socket, raw) => socket.data.connection?.handleMessage(raw),
      drain: (socket) => socket.data.connection?.handleDrain(),
      close: (socket) => socket.data.connection?.handleClose(),
    },
  })

  const waitUntilEmpty = (): Promise<void> => {
    if (open.size === 0) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const bound = setTimeout(done, STREAM_DRAIN_TIMEOUT_MS)
      function done(): void {
        clearTimeout(bound)
        emptied = undefined
        resolve()
      }
      emptied = done
    })
  }

  return {
    port: server.port ?? args.port,
    connections: () => open.size,
    drain: async ({ reconnectAfterMs }) => {
      draining = true
      for (const connection of [...open]) {
        connection.goAway(
          reconnectAfterMs ?? Math.floor(timers.random() * STREAM_DRAIN_RECONNECT_SPREAD_MS),
        )
      }
      await waitUntilEmpty()
    },
    stop: async () => {
      draining = true
      for (const connection of [...open]) connection.close(EStreamServerClose.InternalError)
      await server.stop(true)
    },
  }
}
