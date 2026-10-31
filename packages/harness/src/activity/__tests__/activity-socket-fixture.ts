import type { ServerWebSocket } from 'bun'
import {
  bearerSubprotocolOf,
  CHANNEL_PROTOCOL_MIN_VERSION,
  CHANNEL_PROTOCOL_VERSION,
  decodeClientFrame,
  ECapability,
  EClientFrame,
  EClientRequest,
  EServeFrame,
  encodeFrame,
  type ReadActivityReply,
  type ServeFrame,
  type WireEvent,
} from '@dltech/atlas-wire'

export const activitySocketFixture = (args: {
  snapshot: ReadActivityReply
  port?: number
  supported?: boolean
  refuse?: boolean
  greet?: boolean
  holdEvents?: boolean
}) => {
  let snapshot = args.snapshot
  let events: WireEvent[] = []
  let seq = 1
  let holdActivity = false
  let holdAfter = Number.POSITIVE_INFINITY
  const waitingReads = new Set<{ count: number; resolve: () => void }>()
  let connections = 0
  const closedWaiters = new Set<() => void>()
  const sockets = new Set<ServerWebSocket<undefined>>()
  const pending: (() => void)[] = []
  const requests: EClientRequest[] = []
  let reads = 0
  let onRead: () => void = () => undefined
  let readStarted = new Promise<void>((resolve) => {
    onRead = resolve
  })
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: args.port ?? 0,
    fetch(request, server) {
      if (
        !request.headers
          .get('sec-websocket-protocol')
          ?.includes(bearerSubprotocolOf('existing-token'))
      )
        return new Response(null, { status: 401 })
      return server.upgrade(request) ? undefined : new Response(null, { status: 400 })
    },
    websocket: {
      open(socket) {
        sockets.add(socket)
        connections += 1
      },
      close(socket) {
        sockets.delete(socket)
        if (sockets.size === 0) {
          for (const resolve of closedWaiters) resolve()
          closedWaiters.clear()
        }
      },
      message(socket, data) {
        const frame = decodeClientFrame(String(data))
        if (frame?.kind === EClientFrame.Hello) {
          if (args.greet === false) return
          socket.send(
            encodeFrame({
              kind: EServeFrame.Ready,
              seq,
              protocol: CHANNEL_PROTOCOL_VERSION,
              minProtocol: CHANNEL_PROTOCOL_MIN_VERSION,
              capabilities: args.supported === false ? [] : [ECapability.ReadActivity],
            }),
          )
          return
        }
        if (frame?.kind !== EClientFrame.Request) return
        requests.push(frame.op)
        const reply = ({ data, ok = true }: { data: unknown; ok?: boolean }) =>
          socket.send(
            encodeFrame({
              kind: EServeFrame.Reply,
              replyTo: frame.id,
              ok,
              data,
            }),
          )
        if (frame.op === EClientRequest.ReadActivity) {
          reads += 1
          onRead()
          for (const waiter of waitingReads) {
            if (reads < waiter.count) continue
            waitingReads.delete(waiter)
            waiter.resolve()
          }
          if (args.refuse === true) return void reply({ data: 'refused', ok: false })
          if (holdActivity || reads > holdAfter) {
            pending.push(() => reply({ data: snapshot }))
            return
          }
          reply({ data: snapshot })
        } else if (frame.op === EClientRequest.ReadEvents) {
          if (args.holdEvents === true) return
          const params = frame.params as { threadId: string; fromSeq?: number }
          reply({
            data: {
              events: events.filter(
                (event) => event.threadId === params.threadId && event.seq > (params.fromSeq ?? 0),
              ),
            },
          })
        } else if (frame.op === EClientRequest.ReadThread) {
          reply({ data: { thread: null } })
        } else reply({ data: 'unexpected request', ok: false })
      },
    },
  })
  return {
    url: `http://127.0.0.1:${server.port}`,
    port: server.port ?? 0,
    requests,
    sockets,
    reads: () => reads,
    connections: () => connections,
    whenEmpty: () =>
      sockets.size === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            closedWaiters.add(resolve)
          }),
    setSnapshot: (value: ReadActivityReply) => {
      snapshot = value
    },
    setEvents: (value: WireEvent[]) => {
      events = value
    },
    hold: () => {
      holdActivity = true
    },
    holdAfter: (count: number) => {
      holdAfter = count
    },
    waitForReads: (count: number) =>
      reads >= count
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            waitingReads.add({ count, resolve })
          }),
    release: () => {
      for (const reply of pending.splice(0)) reply()
    },
    readStarted: () => readStarted,
    nextRead: () => {
      readStarted = new Promise<void>((resolve) => {
        onRead = resolve
      })
      return readStarted
    },
    signal: () => {
      seq += 1
      for (const socket of sockets)
        socket.send(
          encodeFrame({
            kind: EServeFrame.Signal,
            seq,
            signal: { type: 'events-appended' },
          }),
        )
    },
    send: (frame: ServeFrame) => {
      for (const socket of sockets) socket.send(encodeFrame(frame))
    },
    drop: () => {
      for (const socket of sockets) socket.close()
    },
    stopListening: () => server.stop(false),
    stop: () => server.stop(true),
  }
}
