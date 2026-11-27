import { afterEach, describe, expect, it } from 'bun:test'
import { createServer, type Server, type Socket } from 'node:net'
import { sessionStorageFromEnv } from './auth-session-storage'

const silentRedis = async (): Promise<{ url: string; close(): void }> => {
  const sockets: Socket[] = []
  const server: Server = createServer((socket) => {
    sockets.push(socket)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return {
    url: `redis://127.0.0.1:${address.port}`,
    close: () => {
      for (const socket of sockets) socket.destroy()
      server.close()
    },
  }
}

describe('sessionStorageFromEnv against a Redis that accepts but never answers', () => {
  let close: (() => void) | undefined
  afterEach(() => close?.())

  it('falls back to Postgres instead of holding the sign-up transaction open', async () => {
    const redis = await silentRedis()
    close = redis.close
    const storage = sessionStorageFromEnv({ url: redis.url, commandTimeoutMs: 100, log: () => {} })
    if (storage === undefined) throw new Error('storage expected')

    const startedAt = Date.now()
    expect(await storage.get('active-sessions-user')).toBeNull()
    await storage.set('token', 'session', 60)

    expect(Date.now() - startedAt).toBeLessThan(2_000)
  }, 5_000)
})
