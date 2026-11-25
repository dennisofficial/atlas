import { Module } from '@nestjs/common'
import { ProjectsModule } from '../projects/projects.module'
import { SkillUsageService } from './skill-usage.service'
import { SkillsRouter } from './skills.router'
import { SkillsService } from './skills.service'

@Module({
  imports: [ProjectsModule],
  providers: [SkillsRouter, SkillsService, SkillUsageService],
  exports: [SkillsService],
})
export class SkillsModule {}
