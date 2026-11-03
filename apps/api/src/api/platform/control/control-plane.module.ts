import { Module, type Provider } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { RedisModule } from '../../../_lib/redis/redis.module'
import { RedisService } from '../../../_lib/redis/redis.service'
import { DbProjectAccess, ProjectAccess } from './project-access'
import { SessionsRouter } from './sessions.router'
import { SessionsService } from './sessions.service'
import { DisabledWakePublisher, RedisWakePublisher, WakePublisher } from './wake.publisher'

export const controlPlaneProvider: Provider = {
  provide: ControlPlane,
  useFactory: (): ControlPlane => new ControlPlane({ store: new PostgresControlStore(db) }),
}

export const wakePublisherProvider: Provider = {
  provide: WakePublisher,
  inject: [RedisService],
  useFactory: (redis: RedisService): WakePublisher =>
    redis.isConfigured() ? new RedisWakePublisher(redis) : new DisabledWakePublisher(),
}

@Module({
  imports: [RedisModule],
  providers: [
    controlPlaneProvider,
    wakePublisherProvider,
    { provide: ProjectAccess, useClass: DbProjectAccess },
    SessionsService,
    SessionsRouter,
  ],
  exports: [ControlPlane],
})
export class ControlPlaneModule {}
