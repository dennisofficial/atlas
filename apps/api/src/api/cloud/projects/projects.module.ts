import { Module } from '@nestjs/common'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { GithubModule } from '../github/github.module'
import { ProjectResourcesController } from './project-resources.controller'
import { ProjectResourcesService } from './project-resources.service'
import { ProjectWorkspaceController } from './project-workspace.controller'
import { ProjectsController } from './projects.controller'
import { ProjectsService } from './projects.service'

@Module({
  imports: [GithubModule, SessionsModule],
  controllers: [ProjectsController, ProjectResourcesController, ProjectWorkspaceController],
  providers: [ProjectsService, ProjectResourcesService],
})
export class ProjectsModule {}
