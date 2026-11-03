import type { DaemonEngine, EngineLink } from '@dltech/atlas-protocol/engine'

type SocketData = { link: EngineLink | null }

export type DaemonListener = { port: number; stop(): void }

export const listenWebSocket = (args: { engine: DaemonEngine; port: number }): DaemonListener => {
  const server = Bun.serve<SocketData>({
    port: args.port,
    fetch(request, server) {
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
