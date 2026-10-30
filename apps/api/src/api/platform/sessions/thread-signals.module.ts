import { Module } from '@nestjs/common'
import { backgroundWorkProvider } from '../../../_lib/background-work/background-work.providers'
import { RedisModule } from '../../../_lib/redis/redis.module'
import { HealthModule } from '../health/health.module'
import { threadSignalBusProvider } from './thread-signal.bus'
import { ThreadSignalsService } from './thread-signals.service'

@Module({
  imports: [HealthModule, RedisModule],
  providers: [threadSignalBusProvider, backgroundWorkProvider(), ThreadSignalsService],
  exports: [ThreadSignalsService],
})
export class ThreadSignalsModule {}
