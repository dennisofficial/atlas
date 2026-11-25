import { Module } from '@nestjs/common'
import { GithubModule } from '../github/github.module'
import { ProjectFileMountsService } from './project-file-mounts.service'
import { ProjectResourcesRouter } from './project-resources.router'
import { ProjectResourcesService } from './project-resources.service'
import { ProjectSettingsService } from './project-settings.service'
import { ProjectsRouter } from './projects.router'
import { ProjectsService } from './projects.service'

@Module({
  imports: [GithubModule],
  providers: [
    ProjectsService,
    ProjectResourcesService,
    ProjectFileMountsService,
    ProjectSettingsService,
    ProjectsRouter,
    ProjectResourcesRouter,
  ],
  exports: [ProjectsService],
})
export class ProjectsModule {}
