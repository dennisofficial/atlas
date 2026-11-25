import { Module } from '@nestjs/common'
import { ProjectsModule } from '../projects/projects.module'
import { AccessGrantsRouter } from './access-grants.router'
import { AccessGrantsService } from './access-grants.service'
import { PersonalAccessGrantsService } from './personal-access-grants.service'
import { ProjectAccessGrantsService } from './project-access-grants.service'

@Module({
  imports: [ProjectsModule],
  providers: [
    AccessGrantsRouter,
    AccessGrantsService,
    PersonalAccessGrantsService,
    ProjectAccessGrantsService,
  ],
})
export class AccessGrantsModule {}
