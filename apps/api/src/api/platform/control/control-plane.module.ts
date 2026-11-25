import { Module, type Provider } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { githubAppTargetStatesOf } from '@dltech/atlas-github'
import { ContextContentStore, ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import type { ProductAnalytics } from '@dltech/atlas-observability'
import { eventSchemaOf } from '@dltech/atlas-plugin-sdk'
import {
  AnalyticsModule,
  PRODUCT_ANALYTICS,
  SecretCipher,
  analyticsAppendHook,
  diagramRepairerOf,
} from '../../../agent'
import { EnvService } from '../../../_core/config/env/env.service'
import { changeContentStoreProvider } from '../../../_lib/changes/change-content.provider'
import { contextContentStoreProvider } from '../../../_lib/changes/context-content.provider'
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
import { ContextMirrorRouter } from './context-mirror.router'
import { ContextMirrorService } from './context-mirror.service'
import { ServicesRouter } from './services.router'
import { ServicesService } from './services.service'
import { SessionsRouter } from './sessions.router'
import { TerminalRouter } from './terminal.router'
import { TerminalService } from './terminal.service'
import { SessionsService } from './sessions.service'
import { PodMetricsService } from './pod-metrics.service'
import { PodPowerService } from './pod-power.service'
import { PodSizingService } from './pod-sizing.service'
import { PreviewsModule } from '../previews/previews.module'
import { RedisModule } from '../../../_lib/redis/redis.module'
import { NotificationsRouter } from './notifications.router'
import { NotifyDevicesService } from './notify-devices.service'
import { PresenceRegistry } from './presence-registry'
import { DiagramsRouter } from './diagrams.router'
import { DIAGRAM_REPAIRER, DiagramRepairService } from './diagram-repair.service'
import { SessionDraftsRouter } from './session-drafts.router'
import { SessionDraftsService } from './session-drafts.service'

export const controlPlaneProvider: Provider = {
  provide: ControlPlane,
  useFactory: (analytics: ProductAnalytics, env: EnvService): ControlPlane =>
    new ControlPlane({
      store: new PostgresControlStore(db),
      eventSchema: eventSchemaOf(registeredPlugins),
      pluginViews: composedPlugins.views,
      appendHooks: [...composedPlugins.control.hooks, analyticsAppendHook(analytics)],
      targetStates: githubAppTargetStatesOf({
        appId: env.get('GITHUB_APP_ID'),
        appPrivateKey: env.get('GITHUB_APP_PRIVATE_KEY'),
      }),
    }),
  inject: [PRODUCT_ANALYTICS, EnvService],
}

@Module({
  imports: [AnalyticsModule, PreviewsModule, RedisModule],
  providers: [
    controlPlaneProvider,
    { provide: ProjectAccess, useClass: DbProjectAccess },
    backgroundWorkProvider(),
    { provide: MediaRegistry, useClass: DbMediaRegistry },
    mediaStoreProvider,
    changeContentStoreProvider,
    contextContentStoreProvider,
    { provide: COMMAND_REGISTRY, useFactory: nativeCommandRegistry },
    SessionsService,
    PodMetricsService,
    PodSizingService,
    PodPowerService,
    SessionsRouter,
    FilesService,
    FilesRouter,
    ContextMirrorService,
    ContextMirrorRouter,
    ServicesService,
    ServicesRouter,
    ChangesService,
    MediaService,
    MediaRouter,
    RoutinesService,
    RoutinesRouter,
    TerminalService,
    TerminalRouter,
    PresenceRegistry,
    NotifyDevicesService,
    NotificationsRouter,
    DiagramRepairService,
    {
      provide: DIAGRAM_REPAIRER,
      useFactory: (env: EnvService) =>
        diagramRepairerOf({
          db,
          cipher: new SecretCipher(env.get('SECRETS_ENCRYPTION_KEY')),
        }),
      inject: [EnvService],
    },
    DiagramsRouter,
    SessionDraftsService,
    SessionDraftsRouter,
  ],
  exports: [ControlPlane, TerminalService, ContextContentStore],
})
export class ControlPlaneModule {}
