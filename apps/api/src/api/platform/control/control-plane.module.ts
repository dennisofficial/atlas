import { Module, type Provider } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { eventSchemaOf } from '@dltech/atlas-plugin-sdk'
import { backgroundWorkProvider } from '../../../_lib/background-work/background-work.providers'
import { COMMAND_REGISTRY, nativeCommandRegistry } from './command-registry'
import { composedPlugins, registeredPlugins } from './registered-plugins'
import { DbMediaRegistry, MediaRegistry } from './media-registry'
import { mediaStoreProvider } from './media-store.provider'
import { MediaRouter } from './media.router'
import { MediaService } from './media.service'
import { DbProjectAccess, ProjectAccess } from './project-access'
import { SessionsRouter } from './sessions.router'
import { SessionsService } from './sessions.service'

export const controlPlaneProvider: Provider = {
  provide: ControlPlane,
  useFactory: (): ControlPlane =>
    new ControlPlane({
      store: new PostgresControlStore(db),
      eventSchema: eventSchemaOf(registeredPlugins),
      pluginViews: composedPlugins.views,
      appendHooks: composedPlugins.control.hooks,
    }),
}

@Module({
  providers: [
    controlPlaneProvider,
    { provide: ProjectAccess, useClass: DbProjectAccess },
    backgroundWorkProvider(),
    { provide: MediaRegistry, useClass: DbMediaRegistry },
    mediaStoreProvider,
    { provide: COMMAND_REGISTRY, useFactory: nativeCommandRegistry },
    SessionsService,
    SessionsRouter,
    MediaService,
    MediaRouter,
  ],
  exports: [ControlPlane],
})
export class ControlPlaneModule {}
