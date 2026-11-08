import {
  type DaemonEngine,
  type EngineLink,
  daemonTokenMatches,
} from '@dltech/atlas-protocol/engine'

type SocketData = { link: EngineLink | null }

export type DaemonListener = { port: number; stop(): void }

const DAEMON_DRAIN_DEADLINE_MS = 600_000
const BEARER = /^Bearer (.+)$/

const bearerOf = (request: Request): string => {
  const match = BEARER.exec(request.headers.get('authorization') ?? '')
  return match?.[1] ?? ''
}

const deadlineOf = async (request: Request): Promise<number> => {
  try {
    const body: unknown = await request.json()
    if (typeof body !== 'object' || body === null || !('deadlineMs' in body)) {
      return DAEMON_DRAIN_DEADLINE_MS
    }
    const { deadlineMs } = body
    if (typeof deadlineMs !== 'number' || !Number.isFinite(deadlineMs) || deadlineMs < 0) {
      return DAEMON_DRAIN_DEADLINE_MS
    }
    return deadlineMs
  } catch {
    return DAEMON_DRAIN_DEADLINE_MS
  }
}

export const listenWebSocket = (args: {
  engine: DaemonEngine
  port: number
  token: string
  drain(deadlineMs: number): void
}): DaemonListener => {
  let draining = false
  const handleDrain = async (request: Request): Promise<Response> => {
    if (!daemonTokenMatches({ want: args.token, token: bearerOf(request) })) {
      return new Response('forbidden', { status: 403 })
    }
    if (draining) return new Response('draining', { status: 409 })
    draining = true
    const deadlineMs = await deadlineOf(request)
    queueMicrotask(() => args.drain(deadlineMs))
    return new Response('draining', { status: 202 })
  }
  const server = Bun.serve<SocketData>({
    port: args.port,
    fetch(request, server) {
      const { pathname } = new URL(request.url)
      if (request.method === 'POST' && pathname === '/drain') return handleDrain(request)
      if (server.upgrade(request, { data: { link: null } })) return undefined
      return new Response('atlas-daemon', { status: 200 })
    },
    websocket: {
      open(ws) {
        ws.data.link = args.engine.connect({
          send: (text) => {
            ws.send(text)
          },
          close: ({ code, reason }) => ws.close(code, reason),
        })
      },
      message(ws, message) {
        const text = typeof message === 'string' ? message : Buffer.from(message).toString('utf8')
        ws.data.link?.receive(text)
      },
      close(ws) {
        ws.data.link?.closed()
        ws.data.link = null
      },
    },
  })
  return {
    port: server.port ?? args.port,
    stop: () => {
      void server.stop(true)
    },
  }
}
