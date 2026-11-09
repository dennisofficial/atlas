import { Module, type Provider } from '@nestjs/common'
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import type { Db } from '@dltech/atlas-db'
import type { HostBus } from '@dltech/atlas-host'
import type { LogPort } from '@dltech/atlas-observability'
import { eventSchemaOf } from '@dltech/atlas-plugin-sdk'

import { createHostBus } from '../bus/host-bus'
import { startPgWakeListener, type PgWakeListener } from '../bus/pg-wake-listener'
import { createRedisLiveFrames, type RedisLiveFrames } from '../bus/redis-live-frames'
import { databaseUrlWithTls } from '../config/database-url'
import type { AgentHostEnv } from '../config/env'
import { composedPlugins, registeredPlugins } from '../registered-plugins'
import { FollowStack } from './follow-stack'
import {
  AGENT_HOST_ENV,
  CONTROL_PLANE,
  DB,
  FOLLOW_STACK,
  HOST_BUS,
  LIVE_FRAMES,
  LOG,
  WAKE_LISTENER,
} from './tokens'

const controlPlaneProvider: Provider = {
  provide: CONTROL_PLANE,
  useFactory: (db: Db): ControlPlane =>
    new ControlPlane({
      store: new PostgresControlStore(db),
      eventSchema: eventSchemaOf(registeredPlugins),
      pluginViews: composedPlugins.views,
      appendHooks: composedPlugins.control.hooks,
    }),
  inject: [DB],
}

const liveFramesProvider: Provider = {
  provide: LIVE_FRAMES,
  useFactory: (env: AgentHostEnv, log: LogPort): RedisLiveFrames =>
    createRedisLiveFrames({ url: env.redisUrl, log }),
  inject: [AGENT_HOST_ENV, LOG],
}

const wakeListenerProvider: Provider = {
  provide: WAKE_LISTENER,
  useFactory: (env: AgentHostEnv, log: LogPort): PgWakeListener =>
    startPgWakeListener({ url: databaseUrlWithTls(env.databaseDirectUrl), log }),
  inject: [AGENT_HOST_ENV, LOG],
}

const hostBusProvider: Provider = {
  provide: HOST_BUS,
  useFactory: (wakes: PgWakeListener, liveFrames: RedisLiveFrames): HostBus =>
    createHostBus({ wakes, liveFrames }),
  inject: [WAKE_LISTENER, LIVE_FRAMES],
}

const followStackProvider: Provider = {
  provide: FOLLOW_STACK,
  useFactory: (env: AgentHostEnv, plane: ControlPlane, log: LogPort): FollowStack =>
    new FollowStack({ env, plane, log }),
  inject: [AGENT_HOST_ENV, CONTROL_PLANE, LOG],
}

@Module({
  providers: [
    controlPlaneProvider,
    liveFramesProvider,
    wakeListenerProvider,
    hostBusProvider,
    followStackProvider,
  ],
  exports: [CONTROL_PLANE, LIVE_FRAMES, WAKE_LISTENER, HOST_BUS, FOLLOW_STACK],
})
export class ControlModule {}
