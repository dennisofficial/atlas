import { afterEach, describe, expect, it, vi } from 'bun:test'
import { EnvService } from '../../_core/config/env/env.service'
import { RedisService } from './redis.service'

const URL = 'redis://localhost:59999'

function serviceWith(config: { REDIS_URL?: string }): RedisService {
  return new RedisService(new EnvService(config))
}

describe('RedisService', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('configured', () => {
    it('reports configured when REDIS_URL is set', () => {
      expect(serviceWith({ REDIS_URL: URL }).isConfigured()).toBe(true)
    })

    it('builds the client without opening a connection', () => {
      const service = serviceWith({ REDIS_URL: URL })

      expect(service.client().status).toBe('wait')
      expect(service.client().options.lazyConnect).toBe(true)
    })

    it('reads the endpoint and tuning from the env and the service', () => {
      const { options } = serviceWith({ REDIS_URL: URL }).client()

      expect(options.port).toBe(59999)
      expect(options.keepAlive).toBe(10_000)
      expect(options.maxRetriesPerRequest).toBe(3)
    })

    it('hands out one shared command connection', () => {
      const service = serviceWith({ REDIS_URL: URL })

      expect(service.client()).toBe(service.client())
    })

    it('duplicates into an independent, still-lazy connection per call', () => {
      const service = serviceWith({ REDIS_URL: URL })
      const shared = service.client()
      const first = service.duplicate()
      const second = service.duplicate()

      expect(first).not.toBe(shared)
      expect(second).not.toBe(first)
      expect(first.status).toBe('wait')
      expect(first.options.port).toBe(59999)
    })

    it('never promotes a duplicate into the shared connection', () => {
      const service = serviceWith({ REDIS_URL: URL })
      const subscriber = service.duplicate()

      expect(service.client()).not.toBe(subscriber)
    })
  })

  describe('quit semantics', () => {
    it('does not quit a client that never connected', async () => {
      const service = serviceWith({ REDIS_URL: URL })
      const quit = vi.spyOn(service.client(), 'quit')

      await service.onModuleDestroy()

      expect(quit).not.toHaveBeenCalled()
    })

    it('quits a client whose connection was opened', async () => {
      const service = serviceWith({ REDIS_URL: URL })
      const shared = service.client()
      shared.status = 'ready'
      const quit = vi.spyOn(shared, 'quit').mockResolvedValue('OK')

      await service.onModuleDestroy()

      expect(quit).toHaveBeenCalledTimes(1)
    })

    it('leaves duplicates to their owner', async () => {
      const service = serviceWith({ REDIS_URL: URL })
      const subscriber = service.duplicate()
      const quit = vi.spyOn(subscriber, 'quit')

      await service.onModuleDestroy()

      expect(quit).not.toHaveBeenCalled()
    })

    it('rebuilds a fresh client after destroy', async () => {
      const service = serviceWith({ REDIS_URL: URL })
      const before = service.client()
      before.status = 'ready'
      vi.spyOn(before, 'quit').mockResolvedValue('OK')

      await service.onModuleDestroy()

      expect(service.client()).not.toBe(before)
    })

    it('destroys cleanly when nothing was ever requested', async () => {
      await expect(serviceWith({ REDIS_URL: URL }).onModuleDestroy()).resolves.toBeUndefined()
    })
  })

  describe('unconfigured', () => {
    it('reports not configured when REDIS_URL is absent', () => {
      expect(serviceWith({}).isConfigured()).toBe(false)
    })

    it('refuses client() instead of connecting to localhost', () => {
      expect(() => serviceWith({}).client()).toThrow(/REDIS_URL is not set/)
    })

    it('refuses duplicate() the same way', () => {
      expect(() => serviceWith({}).duplicate()).toThrow(/REDIS_URL is not set/)
    })

    it('destroys cleanly', async () => {
      await expect(serviceWith({}).onModuleDestroy()).resolves.toBeUndefined()
    })
  })
})
