import { Module, type Provider } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
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
    SessionsService,
    SessionsRouter,
  ],
  exports: [ControlPlane],
})
export class ControlPlaneModule {}
