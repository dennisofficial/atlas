import type { EnvService } from '../_core/config/env/env.service'
import { RedisService } from '../_lib/redis/redis.service'
import { DrainStateService } from '../api/platform/health/drain-state.service'
import {
  InProcessThreadSignalBus,
  RedisThreadSignalBus,
  type ThreadSignalBus,
} from '../api/platform/sessions/thread-signal.bus'
import { ThreadSignalsService } from '../api/platform/sessions/thread-signals.service'

export type WorkerThreadSignals = { signals: ThreadSignalsService; dispose: () => Promise<void> }

export function buildWorkerThreadSignals(args: { env: EnvService }): WorkerThreadSignals {
  const redis = new RedisService(args.env)
  const bus: ThreadSignalBus = redis.isConfigured()
    ? new RedisThreadSignalBus(redis)
    : new InProcessThreadSignalBus()
  return {
    signals: new ThreadSignalsService(new DrainStateService(), bus),
    dispose: async () => {
      await redis.onModuleDestroy()
    },
  }
}
