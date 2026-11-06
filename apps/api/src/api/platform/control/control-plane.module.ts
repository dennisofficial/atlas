import { Module, type Provider } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { backgroundWorkProvider } from '../../../_lib/background-work/background-work.providers'
import { DbMediaRegistry, MediaRegistry } from './media-registry'
import { mediaStoreProvider } from './media-store.provider'
import { MediaRouter } from './media.router'
import { MediaService } from './media.service'
import { DbProjectAccess, ProjectAccess } from './project-access'
import { SessionsRouter } from './sessions.router'
import { SessionsService } from './sessions.service'

export const controlPlaneProvider: Provider = {
  provide: ControlPlane,
  useFactory: (): ControlPlane => new ControlPlane({ store: new PostgresControlStore(db) }),
}

@Module({
  providers: [
    controlPlaneProvider,
    { provide: ProjectAccess, useClass: DbProjectAccess },
    backgroundWorkProvider(),
    { provide: MediaRegistry, useClass: DbMediaRegistry },
    mediaStoreProvider,
    SessionsService,
    SessionsRouter,
    MediaService,
    MediaRouter,
  ],
  exports: [ControlPlane],
})
export class ControlPlaneModule {}
