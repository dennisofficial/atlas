import { Module, type Provider } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { RedisModule } from '../../../_lib/redis/redis.module'
import { RedisService } from '../../../_lib/redis/redis.service'
import { V2SessionsRouter } from './v2-sessions.router'
import { V2SessionsService } from './v2-sessions.service'
import { V2UserMiddleware } from './v2-user.middleware'
import { DisabledV2WakePublisher, RedisV2WakePublisher, V2WakePublisher } from './v2-wake.publisher'

export const controlPlaneProvider: Provider = {
  provide: ControlPlane,
  useFactory: (): ControlPlane => new ControlPlane({ store: new PostgresControlStore(db) }),
}

export const v2WakePublisherProvider: Provider = {
  provide: V2WakePublisher,
  inject: [RedisService],
  useFactory: (redis: RedisService): V2WakePublisher =>
    redis.isConfigured() ? new RedisV2WakePublisher(redis) : new DisabledV2WakePublisher(),
}

@Module({
  imports: [RedisModule],
  providers: [
    controlPlaneProvider,
    v2WakePublisherProvider,
    V2SessionsService,
    V2SessionsRouter,
    V2UserMiddleware,
  ],
  exports: [ControlPlane],
})
export class V2ControlModule {}
