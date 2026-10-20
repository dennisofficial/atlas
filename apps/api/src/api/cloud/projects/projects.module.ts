import { Module } from '@nestjs/common'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { GithubModule } from '../github/github.module'
import { ProjectWorkspaceController } from './project-workspace.controller'
import { ProjectsController } from './projects.controller'
import { ProjectsService } from './projects.service'

@Module({
  imports: [GithubModule, SessionsModule],
  controllers: [ProjectsController, ProjectWorkspaceController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
