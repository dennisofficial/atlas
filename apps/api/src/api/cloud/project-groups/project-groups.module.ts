import { Module } from '@nestjs/common'
import { ProjectsModule } from '../projects/projects.module'
import { GroupInstructionsService } from './group-instructions.service'
import { GroupResourcesRouter } from './group-resources.router'
import { GroupResourcesService } from './group-resources.service'
import { GroupSettingsService } from './group-settings.service'
import { ProjectGroupsRouter } from './project-groups.router'
import { GroupsService } from './project-groups.service'

@Module({
  imports: [ProjectsModule],
  providers: [
    ProjectGroupsRouter,
    GroupsService,
    GroupResourcesRouter,
    GroupResourcesService,
    GroupSettingsService,
    GroupInstructionsService,
  ],
  exports: [GroupsService],
})
export class ProjectGroupsModule {}
