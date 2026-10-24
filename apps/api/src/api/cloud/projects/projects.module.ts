import { Module } from '@nestjs/common'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { GithubModule } from '../github/github.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { ProjectResourcesRouter } from './project-resources.router'
import { ProjectResourcesService } from './project-resources.service'
import { ProjectSettingsService } from './project-settings.service'
import { ProjectWorkspaceRouter } from './project-workspace.router'
import { ProjectsRouter } from './projects.router'
import { ProjectsService } from './projects.service'

@Module({
  imports: [GithubModule, SessionsModule, WorkspacesModule],
  providers: [
    ProjectsService,
    ProjectResourcesService,
    ProjectSettingsService,
    ProjectsRouter,
    ProjectResourcesRouter,
    ProjectWorkspaceRouter,
  ],
  exports: [ProjectsService],
})
export class ProjectsModule {}
