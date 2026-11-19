import {
  MAC_LINK_PROTOCOL_VERSION,
  macHostFrameSchema,
  type JsonRpcMessage,
  type MacClientFrame,
  type MacServerTransport,
} from '@dltech/atlas-protocol/mac-link'

import { macLinkUrlOf } from './url'

export const BACKOFF_BASE_MS = 500

export const BACKOFF_MAX_MS = 30_000

const BAD_TOKEN_CLOSE_CODES = new Set([4401, 4409])

export type MacFrameSink = {
  open(args: { channelId: string; server: { name: string; transport: MacServerTransport } }): void
  rpc(args: { channelId: string; message: JsonRpcMessage }): void
  close(args: { channelId: string }): void
  disconnected(): void
}

export type MacLinkClient = {
  start(): void
  stop(): void
  send(frame: MacClientFrame): void
  status(): { connected: boolean; attempts: number }
}

const NO_SINK: MacFrameSink = {
  open: () => undefined,
  rpc: () => undefined,
  close: () => undefined,
  disconnected: () => undefined,
}

export const createMacLinkClient = (args: {
  apiOrigin: string
  token: () => string | undefined
  deviceId: () => string
  appVersion: () => string
  sink?: ((emit: (frame: MacClientFrame) => void) => MacFrameSink) | undefined
  socketOf?: ((url: string, init: { headers: Record<string, string> }) => WebSocket) | undefined
  timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } | undefined
  random?: (() => number) | undefined
  log?: ((line: string) => void) | undefined
}): MacLinkClient => {
  const timers = args.timers ?? { setTimeout, clearTimeout }
  const random = args.random ?? Math.random
  const connect =
    args.socketOf ??
    ((url: string, init: { headers: Record<string, string> }) => new WebSocket(url, init))

  let socket: WebSocket | undefined
  let sink: MacFrameSink = NO_SINK
  let connected = false
  let stopped = true
  let attempts = 0
  let reconnect: ReturnType<typeof setTimeout> | undefined

  function send(frame: MacClientFrame): void {
    socket?.send(JSON.stringify(frame))
  }

  function start(): void {
    if (!stopped) return
    const token = args.token()
    if (token === undefined) return
    stopped = false
    open(token)
  }

  function stop(): void {
    stopped = true
    connected = false
    if (reconnect !== undefined) {
      timers.clearTimeout(reconnect)
      reconnect = undefined
    }
    const current = socket
    socket = undefined
    current?.close(1000, 'client stopped')
    sink.disconnected()
  }

  function status(): { connected: boolean; attempts: number } {
    return { connected, attempts }
  }

  function open(token: string): void {
    const ws = connect(macLinkUrlOf(args.apiOrigin), {
      headers: { authorization: `Bearer ${token}` },
    })
    socket = ws
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'hello',
          v: MAC_LINK_PROTOCOL_VERSION,
          token,
          deviceId: args.deviceId(),
          appVersion: args.appVersion(),
        }),
      )
    }
    ws.onmessage = (event) => receive(ws, event)
    ws.onerror = () => drop(ws, undefined)
    ws.onclose = (event) => drop(ws, event.code)
  }

  function receive(ws: WebSocket, event: MessageEvent): void {
    if (socket !== ws) return
    const parsed = macHostFrameSchema.safeParse(parseJson(event.data))
    if (!parsed.success) {
      args.log?.('dropped a malformed mac host frame')
      return
    }
    const frame = parsed.data
    switch (frame.type) {
      case 'ready':
        connected = true
        attempts = 0
        return
      case 'ping':
        send({ type: 'pong' })
        return
      case 'open':
        sink.open({ channelId: frame.channelId, server: frame.server })
        return
      case 'rpc':
        sink.rpc({ channelId: frame.channelId, message: frame.message })
        return
      case 'close':
        sink.close({ channelId: frame.channelId })
        return
    }
  }

  function drop(ws: WebSocket, code: number | undefined): void {
    if (socket !== ws) return
    socket = undefined
    connected = false
    sink.disconnected()
    if (stopped) return
    if (code !== undefined && BAD_TOKEN_CLOSE_CODES.has(code)) {
      stopped = true
      return
    }
    scheduleReconnect()
  }

  function scheduleReconnect(): void {
    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempts) * (0.8 + 0.4 * random())
    attempts += 1
    reconnect = timers.setTimeout(() => {
      reconnect = undefined
      const token = args.token()
      if (token === undefined) {
        stopped = true
        return
      }
      open(token)
    }, delay)
  }

  const client: MacLinkClient = { start, stop, send, status }
  sink = args.sink?.(send) ?? NO_SINK
  return client
}

const parseJson = (raw: unknown): unknown => {
  if (typeof raw !== 'string') return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}
