import { Module } from '@nestjs/common'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { GithubModule } from '../github/github.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { ProjectResourcesController } from './project-resources.controller'
import { ProjectResourcesService } from './project-resources.service'
import { ProjectSettingsService } from './project-settings.service'
import { ProjectWorkspaceController } from './project-workspace.controller'
import { ProjectsController } from './projects.controller'
import { ProjectsService } from './projects.service'

@Module({
  imports: [GithubModule, SessionsModule, WorkspacesModule],
  controllers: [ProjectsController, ProjectResourcesController, ProjectWorkspaceController],
  providers: [ProjectsService, ProjectResourcesService, ProjectSettingsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
