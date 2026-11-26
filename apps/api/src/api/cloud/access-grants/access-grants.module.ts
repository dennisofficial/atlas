import { Module } from '@nestjs/common'
import { ProjectGroupsModule } from '../project-groups/project-groups.module'
import { ProjectsModule } from '../projects/projects.module'
import { AccessGrantsRouter } from './access-grants.router'
import { AccessGrantsService } from './access-grants.service'
import { GroupAccessGrantsService } from './group-access-grants.service'
import { LayeredAccessGrantsService } from './layered-access-grants.service'
import { PersonalAccessGrantsService } from './personal-access-grants.service'
import { ProjectAccessGrantsService } from './project-access-grants.service'
import { RelocateAccessGrantsService } from './access-grant-relocation'

@Module({
  imports: [ProjectsModule, ProjectGroupsModule],
  providers: [
    AccessGrantsRouter,
    AccessGrantsService,
    GroupAccessGrantsService,
    LayeredAccessGrantsService,
    PersonalAccessGrantsService,
    ProjectAccessGrantsService,
    RelocateAccessGrantsService,
  ],
})
export class AccessGrantsModule {}
