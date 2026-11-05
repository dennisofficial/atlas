import { STREAM_PROTOCOL_VERSION } from '@dltech/atlas-protocol'

import { MemoryStreamAuth } from '../memory-stream-auth'
import { startStreamServer, type StreamServer } from '../stream-server'
import { FakeTimers } from './fake-timers'
import { TestClient } from './test-client'

export const upgradeHeaders = {
  Upgrade: 'websocket',
  Connection: 'Upgrade',
  'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
  'Sec-WebSocket-Version': '13',
}

export class StreamHarness {
  readonly timers = new FakeTimers()
  readonly auth = new MemoryStreamAuth({ now: () => this.timers.now() })
  server: StreamServer
  private readonly clients: TestClient[] = []

  constructor(args: { trustedOrigins?: string[] } = {}) {
    this.auth.grant({ token: 'tok-a', userId: 'user-a', expiresAt: 3_600_000 })
    this.auth.grant({ token: 'tok-b', userId: 'user-b', expiresAt: 3_600_000 })
    this.server = startStreamServer({
      port: 0,
      auth: this.auth,
      trustedOrigins: args.trustedOrigins ?? [],
      timers: this.timers,
    })
  }

  get httpUrl(): string {
    return `http://127.0.0.1:${this.server.port}`
  }

  connect(args: { headers?: Record<string, string> } = {}): TestClient {
    const client = new TestClient({
      url: `ws://127.0.0.1:${this.server.port}/stream`,
      ...(args.headers === undefined ? {} : { headers: args.headers }),
    })
    this.clients.push(client)
    return client
  }

  async ready(args: { token?: string } = {}): Promise<TestClient> {
    const client = this.connect()
    client.send({ type: 'hello', v: STREAM_PROTOCOL_VERSION, token: args.token ?? 'tok-a' })
    const frame = await client.next()
    if (frame.type !== 'ready') throw new Error(`expected ready, got ${frame.type}`)
    return client
  }

  upgradeAttempt(args: { headers?: Record<string, string> } = {}): Promise<Response> {
    return fetch(`${this.httpUrl}/stream`, { headers: { ...upgradeHeaders, ...args.headers } })
  }

  async dispose(): Promise<void> {
    for (const client of this.clients.splice(0)) client.close()
    await this.server.stop()
  }
}
