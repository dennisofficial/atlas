import { describe, expect, it } from 'bun:test'
import { EventEmitter } from 'node:events'

import { startPgListener } from '../pg-listener'

type Stage = 'connect' | 'listen'

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
})
