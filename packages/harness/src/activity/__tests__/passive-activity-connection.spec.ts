import { expect, test } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'
import {
  ECapability,
  EClientFrame,
  EClientRequest,
  EServeFrame,
  CHANNEL_PROTOCOL_VERSION,
  CHANNEL_PROTOCOL_MIN_VERSION,
  decodeClientFrame,
  encodeFrame,
} from '@dltech/atlas-wire'
import { createPassiveActivityConnection } from '../passive-activity-connection'
import { activitySocketFixture } from './activity-socket-fixture'

const threadId = toThreadId('root')
const snapshot = {
  runtimeId: 'runtime',
  revision: 0,
  turnEpoch: 0,
  working: false,
  awaiting: null,
  observedOutcome: null,
}

test('authenticates an existing Running endpoint and reads activity without any mutation request', async () => {
  const requests: string[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      expect(request.headers.get('sec-websocket-protocol')).toContain('existing-token')
      return server.upgrade(request) ? undefined : new Response(null, { status: 400 })
    },
    websocket: {
      message(socket, data) {
        const frame = decodeClientFrame(String(data))
        if (frame?.kind === EClientFrame.Hello) {
          socket.send(
            encodeFrame({
              kind: EServeFrame.Ready,
              seq: 1,
              protocol: CHANNEL_PROTOCOL_VERSION,
              minProtocol: CHANNEL_PROTOCOL_MIN_VERSION,
              capabilities: [ECapability.ReadActivity],
            }),
          )
        }
        if (frame?.kind === EClientFrame.Request) {
          requests.push(frame.op)
          socket.send(
            encodeFrame({ kind: EServeFrame.Reply, replyTo: frame.id, ok: true, data: snapshot }),
          )
        }
      },
    },
  })
  const connection = createPassiveActivityConnection({
    threadId,
    endpoint: { url: `http://127.0.0.1:${server.port}` },
    token: () => 'existing-token',
    invalidate: () => undefined,
    disconnect: () => undefined,
  })
  try {
    expect(await connection.read()).toEqual(snapshot)
    expect(requests).toEqual([EClientRequest.ReadActivity])
  } finally {
    await connection.close()
    await server.stop(true)
  }
})

test('an unsupported peer or refused read never becomes known idle', async () => {
  for (const options of [{ supported: false }, { refuse: true }]) {
    const socket = activitySocketFixture({ snapshot, ...options })
    const connection = createPassiveActivityConnection({
      threadId,
      endpoint: { url: socket.url },
      token: () => 'existing-token',
      invalidate: () => undefined,
      disconnect: () => undefined,
    })
    try {
      await expect(connection.read()).rejects.toThrow()
      expect(socket.requests).toEqual(
        options.supported === false ? [] : [EClientRequest.ReadActivity],
      )
    } finally {
      await connection.close()
      await socket.stop()
    }
  }
})

test('disconnect rejects pending activity, ignores late reply, and never redials remembered URL', async () => {
  const socket = activitySocketFixture({ snapshot })
  socket.hold()
  const connection = createPassiveActivityConnection({
    threadId,
    endpoint: { url: socket.url },
    token: () => 'existing-token',
    invalidate: () => undefined,
    disconnect: () => undefined,
  })
  try {
    const reading = connection.read()
    await socket.readStarted()
    socket.drop()
    await expect(reading).rejects.toThrow()
    socket.release()
    await expect(connection.read()).rejects.toThrow()
    expect(socket.connections()).toBe(1)
  } finally {
    await connection.close()
    await socket.stop()
  }
})

test('greet timeout cleans the socket and missing credentials open nothing', async () => {
  const socket = activitySocketFixture({ snapshot, greet: false })
  let disconnected = 0
  const connection = createPassiveActivityConnection({
    threadId,
    endpoint: { url: socket.url },
    token: () => 'existing-token',
    timeoutMs: 20,
    invalidate: () => undefined,
    disconnect: () => {
      disconnected += 1
    },
  })
  try {
    await expect(connection.read()).rejects.toThrow('timed out')
    await socket.whenEmpty()
    expect(disconnected).toBe(1)
    expect(socket.sockets.size).toBe(0)
    expect(() =>
      createPassiveActivityConnection({
        threadId,
        endpoint: { url: socket.url },
        token: () => undefined,
        invalidate: () => undefined,
        disconnect: () => undefined,
      }),
    ).toThrow('credential unavailable')
    expect(socket.connections()).toBe(1)
  } finally {
    await connection.close()
    await socket.stop()
  }
})
