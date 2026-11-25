import { Module } from '@nestjs/common'
import { ProjectGroupsModule } from '../project-groups/project-groups.module'
import { ProjectsModule } from '../projects/projects.module'
import { SkillUsageService } from './skill-usage.service'
import { SkillsRouter } from './skills.router'
import { SkillsService } from './skills.service'

@Module({
  imports: [ProjectsModule, ProjectGroupsModule],
  providers: [SkillsRouter, SkillsService, SkillUsageService],
  exports: [SkillsService],
})
export class SkillsModule {}
