import { Module } from '@nestjs/common'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { GithubModule } from '../github/github.module'
import { ProjectsModule } from '../projects/projects.module'
import { SkillCatalogueRouter } from './skill-catalogue.router'
import { SkillCatalogueService } from './skill-catalogue.service'

@Module({
  imports: [SessionsModule, GithubModule, ProjectsModule],
  providers: [SkillCatalogueRouter, SkillCatalogueService],
})
export class SkillCatalogueModule {}
