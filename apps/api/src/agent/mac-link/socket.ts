import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import type { LogPort } from '@dltech/atlas-observability'
import {
  MAC_LINK_PATH,
  macClientFrameSchema,
  type MacClientFrame,
  type MacHostFrame,
} from '@dltech/atlas-protocol/mac-link'
import { WebSocketServer, WebSocket, type RawData } from 'ws'

import type { SessionVerifier } from '../../_core/ports/session-verifier'
import type { MacSocket, MacLinkRegistry } from './registry'

export const MAC_LINK_MAX_FRAME_BYTES = 8 * 1024 * 1024

export const HELLO_TIMEOUT_MS = 5_000

export const PING_INTERVAL_MS = 20_000

export const PONG_DEADLINE_MS = 45_000

const UNAUTHORIZED = 'HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'

const BEARER = /^Bearer (.+)$/i

type SocketRegistry = Pick<MacLinkRegistry, 'attach' | 'detach' | 'handleSocketFrame' | 'touch'>

type Timers = {
  setInterval: typeof setInterval
  clearInterval: typeof clearInterval
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
}

export type MacLinkSocket = { close(): Promise<void> }

export const attachMacLinkSocket = (args: {
  server: Server
  verify: SessionVerifier
  registry: SocketRegistry
  log?: LogPort | undefined
  timers?: Timers | undefined
  now?: (() => number) | undefined
}): MacLinkSocket => {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAC_LINK_MAX_FRAME_BYTES })
  const live = new Set<WebSocket>()
  const timers: Timers = args.timers ?? { setInterval, clearInterval, setTimeout, clearTimeout }
  const now = (): number => args.now?.() ?? Date.now()

  const refuse = (socket: Duplex, status: string): void => {
    socket.end(status)
  }

  const upgrade = async (request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> => {
    const pathname = new URL(request.url ?? '/', 'http://local').pathname
    if (pathname !== MAC_LINK_PATH) {
      socket.destroy()
      return
    }
    const authorization = request.headers.authorization
    if (authorization === undefined || BEARER.exec(authorization) === null) {
      refuse(socket, UNAUTHORIZED)
      return
    }
    const verified = await args.verify.verify({ headers: { authorization } })
    const bearer = BEARER.exec(authorization)?.[1]
    if (verified === null || bearer === undefined) {
      refuse(socket, UNAUTHORIZED)
      return
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      live.add(ws)
      serve({ ws, userId: verified.userId, bearer })
    })
  }

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    upgrade(request, socket, head).catch((error: unknown) => {
      args.log?.error({
        source: 'bus.mac-link',
        message: 'mac-link upgrade failed',
        data: { error: error instanceof Error ? error.message : String(error) },
      })
      socket.destroy()
    })
  }

  const serve = (args2: { ws: WebSocket; userId: string; bearer: string }): void => {
    const { ws } = args2
    let userId: string | undefined
    let deviceId: string | undefined
    let macSocket: MacSocket | undefined
    let lastPongAt = now()
    let keepalive: ReturnType<typeof setInterval> | undefined

    const helloDeadline = timers.setTimeout(() => {
      if (userId === undefined) ws.close(4401, 'unauthorized')
    }, HELLO_TIMEOUT_MS)

    const stopTimers = (): void => {
      timers.clearTimeout(helloDeadline)
      if (keepalive !== undefined) timers.clearInterval(keepalive)
    }

    const startKeepalive = (): void => {
      keepalive = timers.setInterval(() => {
        if (now() - lastPongAt > PONG_DEADLINE_MS) {
          ws.terminate()
          return
        }
        macSocket?.send({ type: 'ping' })
      }, PING_INTERVAL_MS)
    }

    const hello = async (frame: MacClientFrame): Promise<boolean> => {
      if (frame.type !== 'hello' || frame.v < 1 || frame.token !== args2.bearer) {
        ws.close(4401, 'unauthorized')
        return false
      }
      timers.clearTimeout(helloDeadline)
      userId = args2.userId
      deviceId = frame.deviceId
      macSocket = {
        send: (out: MacHostFrame) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(out))
        },
        close: (code: number, reason: string) => ws.close(code, reason),
      }
      await args.registry.attach({ userId, deviceId, socket: macSocket })
      startKeepalive()
      return true
    }

    const onFrame = async (raw: RawData): Promise<void> => {
      const parsed = macClientFrameSchema.safeParse(parseJson(raw))
      if (!parsed.success) {
        args.log?.warn({ source: 'bus.mac-link', message: 'dropped a malformed mac frame' })
        return
      }
      const frame = parsed.data
      if (userId === undefined) {
        await hello(frame)
        return
      }
      if (frame.type === 'hello') return
      if (frame.type === 'pong') {
        lastPongAt = now()
        await args.registry.touch(userId)
        return
      }
      await args.registry.handleSocketFrame(userId, frame)
    }

    ws.on('message', (raw: RawData) => {
      onFrame(raw).catch((error: unknown) => {
        args.log?.error({
          source: 'bus.mac-link',
          message: 'mac-link frame handling failed',
          data: { error: error instanceof Error ? error.message : String(error) },
        })
      })
    })
    ws.on('error', (error: unknown) => {
      args.log?.warn({
        source: 'bus.mac-link',
        message: 'mac-link socket error',
        data: { error: error instanceof Error ? error.message : String(error) },
      })
    })
    ws.on('close', () => {
      stopTimers()
      live.delete(ws)
      if (userId !== undefined && macSocket !== undefined) {
        args.registry.detach(userId, macSocket).catch(() => undefined)
      }
    })
  }

  args.server.on('upgrade', onUpgrade)

  return {
    async close() {
      args.server.off('upgrade', onUpgrade)
      for (const ws of live) ws.terminate()
      live.clear()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
    },
  }
}

const parseJson = (raw: RawData): unknown => {
  try {
    return JSON.parse(raw.toString())
  } catch {
    return undefined
  }
}
