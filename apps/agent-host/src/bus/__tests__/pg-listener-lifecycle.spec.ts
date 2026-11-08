import { describe, expect, it } from 'bun:test'
import { EventEmitter } from 'node:events'

import { LogPort } from '@dltech/atlas-observability'

import { startPgListener } from '../pg-listener'

class MemoryLog extends LogPort {
  readonly messages: string[] = []
  record(entry: Parameters<LogPort['record']>[0]): void {
    this.messages.push(entry.message)
  }
}

type Stage = 'connect' | 'listen'

class HangingClient extends EventEmitter {
  ended = false

  constructor(private readonly hangAt: Stage) {
    super()
  }

  connect(): Promise<unknown> {
    return this.hangAt === 'connect' ? new Promise(() => {}) : Promise.resolve({})
  }

  query(): Promise<unknown> {
    return this.hangAt === 'listen' ? new Promise(() => {}) : Promise.resolve({})
  }

  end(): Promise<void> {
    this.ended = true
    return Promise.resolve()
  }
}

class DyingClient extends EventEmitter {
  ended = false

  constructor(private readonly args: { dieAt?: Stage; event?: 'error' | 'end'; refuse?: boolean }) {
    super()
  }

  private stage(stage: Stage): Promise<unknown> {
    if (this.args.refuse === true) return Promise.reject(new Error('refused'))
    if (this.args.dieAt === stage) {
      if (this.args.event === 'error') this.emit('error', new Error('socket closed'))
      else this.emit('end')
    }
    return Promise.resolve({})
  }

  connect(): Promise<unknown> {
    return this.stage('connect')
  }

  query(): Promise<unknown> {
    return this.stage('listen')
  }

  end(): Promise<void> {
    this.ended = true
    return Promise.resolve()
  }
}

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const realTimeout = globalThis.setTimeout

const realSettle = (ms: number): Promise<void> => new Promise((resolve) => realTimeout(resolve, ms))

describe('pg listener lifecycle', () => {
  for (const dieAt of ['connect', 'listen'] as const) {
    for (const event of ['error', 'end'] as const) {
      it(`an attempt dropped by ${event} during ${dieAt} never reports a reconnect`, async () => {
        const clients: DyingClient[] = []
        const listener = startPgListener({
          url: 'postgres://unused',
          channels: ['c'],
          createClient: () => {
            const client = new DyingClient(clients.length === 0 ? { dieAt, event } : {})
            clients.push(client)
            return client
          },
        })
        let reconnects = 0
        listener.onReconnect(() => {
          reconnects += 1
        })
        await settle(20)
        expect(reconnects).toBe(0)
        await settle(400)
        expect(clients.length).toBe(2)
        expect(reconnects).toBe(1)
        await listener.close()
      })
    }
  }

  it('close during backoff cancels the retry', async () => {
    const pending = new Set<unknown>()
    const realSet = globalThis.setTimeout
    const realClear = globalThis.clearTimeout
    globalThis.setTimeout = ((handler: () => void, ms?: number) => {
      const handle = realSet(() => {
        pending.delete(handle)
        handler()
      }, ms)
      pending.add(handle)
      return handle
    }) as typeof setTimeout
    globalThis.clearTimeout = ((handle?: Parameters<typeof clearTimeout>[0]) => {
      pending.delete(handle)
      realClear(handle)
    }) as typeof clearTimeout
    let created = 0
    const listener = startPgListener({
      url: 'postgres://unused',
      channels: ['c'],
      createClient: () => {
        created += 1
        return new DyingClient({ refuse: true })
      },
    })
    await realSettle(20)
    expect(created).toBe(1)
    try {
      expect(pending.size).toBe(1)
      await listener.close()
      expect(pending.size).toBe(0)
    } finally {
      globalThis.setTimeout = realSet
      globalThis.clearTimeout = realClear
    }
    await settle(400)
    expect(created).toBe(1)
  })

  for (const hangAt of ['connect', 'listen'] as const) {
    it(`an attempt that hangs during ${hangAt} is dropped and retried`, async () => {
      const clients: (HangingClient | DyingClient)[] = []
      const log = new MemoryLog()
      const listener = startPgListener({
        url: 'postgres://unused',
        channels: ['c'],
        connectTimeoutMs: 30,
        queryTimeoutMs: 30,
        log,
        createClient: () => {
          const client = clients.length === 0 ? new HangingClient(hangAt) : new DyingClient({})
          clients.push(client)
          return client
        },
      })
      let reconnects = 0
      listener.onReconnect(() => {
        reconnects += 1
      })
      await realSettle(600)
      expect(clients.length).toBe(2)
      expect(clients[0]?.ended).toBe(true)
      expect(reconnects).toBe(1)
      expect(log.messages).toContain('listener connect failed')
      await listener.close()
    })
  }
})
