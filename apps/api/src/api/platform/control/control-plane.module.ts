import { Module, type Provider } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import type { ProductAnalytics } from '@dltech/atlas-observability'
import { eventSchemaOf } from '@dltech/atlas-plugin-sdk'
import { AnalyticsModule, PRODUCT_ANALYTICS, analyticsAppendHook } from '../../../agent'
import { changeContentStoreProvider } from '../../../_lib/changes/change-content.provider'
import { backgroundWorkProvider } from '../../../_lib/background-work/background-work.providers'
import { COMMAND_REGISTRY, nativeCommandRegistry } from './command-registry'
import { composedPlugins, registeredPlugins } from '@dltech/atlas-pods'
import { DbMediaRegistry, MediaRegistry } from './media-registry'
import { mediaStoreProvider } from './media-store.provider'
import { ChangesService } from './changes.service'
import { MediaRouter } from './media.router'
import { MediaService } from './media.service'
import { DbProjectAccess, ProjectAccess } from './project-access'
import { RoutinesRouter } from './routines.router'
import { RoutinesService } from './routines.service'
import { FilesRouter } from './files.router'
import { FilesService } from './files.service'
import { SessionsRouter } from './sessions.router'
import { TerminalRouter } from './terminal.router'
import { TerminalService } from './terminal.service'
import { SessionsService } from './sessions.service'
import { PodMetricsService } from './pod-metrics.service'
import { PodPowerService } from './pod-power.service'
import { PodSizingService } from './pod-sizing.service'
import { SandboxesModule } from '../sandboxes/sandboxes.module'
import { RedisModule } from '../../../_lib/redis/redis.module'
import { NotificationsRouter } from './notifications.router'
import { PresenceRegistry } from './presence-registry'

export const controlPlaneProvider: Provider = {
  provide: ControlPlane,
  useFactory: (analytics: ProductAnalytics): ControlPlane =>
    new ControlPlane({
      store: new PostgresControlStore(db),
      eventSchema: eventSchemaOf(registeredPlugins),
      pluginViews: composedPlugins.views,
      appendHooks: [...composedPlugins.control.hooks, analyticsAppendHook(analytics)],
    }),
  inject: [PRODUCT_ANALYTICS],
}

@Module({
  imports: [AnalyticsModule, SandboxesModule, RedisModule],
  providers: [
    controlPlaneProvider,
    { provide: ProjectAccess, useClass: DbProjectAccess },
    backgroundWorkProvider(),
    { provide: MediaRegistry, useClass: DbMediaRegistry },
    mediaStoreProvider,
    changeContentStoreProvider,
    { provide: COMMAND_REGISTRY, useFactory: nativeCommandRegistry },
    SessionsService,
    PodMetricsService,
    PodSizingService,
    PodPowerService,
    SessionsRouter,
    FilesService,
    FilesRouter,
    ChangesService,
    MediaService,
    MediaRouter,
    RoutinesService,
    RoutinesRouter,
    TerminalService,
    TerminalRouter,
    PresenceRegistry,
    NotificationsRouter,
  ],
  exports: [ControlPlane, TerminalService],
})
export class ControlPlaneModule {}
