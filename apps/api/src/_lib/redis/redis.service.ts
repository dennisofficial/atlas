import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { Redis } from 'ioredis'
import { EnvService } from '../../_core/config/env/env.service'

@Injectable()
export class RedisService implements OnModuleDestroy {
  private instance: Redis | undefined

  constructor(private readonly env: EnvService) {}

  isConfigured(): boolean {
    return this.env.get('REDIS_URL') !== undefined
  }

  client(): Redis {
    this.instance ??= this.create()
    return this.instance
  }

  duplicate(): Redis {
    return this.create().duplicate()
  }

  async onModuleDestroy(): Promise<void> {
    const instance = this.instance
    this.instance = undefined
    // ioredis: quit() on a lazyConnect client still in 'wait' never resolves.
    if (!instance || instance.status === 'wait') return
    await instance.quit()
  }

  private create(): Redis {
    const url = this.env.get('REDIS_URL')
    if (url === undefined) {
      throw new Error(
        'REDIS_URL is not set — check RedisService.isConfigured() and run local-only instead of calling client()',
      )
    }
    return new Redis(url, {
      lazyConnect: true,
      // Upstash drops idle TCP connections after ~30 s.
      keepAlive: 10_000,
      maxRetriesPerRequest: 3,
    })
  }
}
