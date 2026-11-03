import { Module } from '@nestjs/common'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { ProjectsModule } from '../projects/projects.module'
import { SkillUsageService } from './skill-usage.service'
import { SkillsRouter } from './skills.router'
import { SkillsService } from './skills.service'

@Module({
  imports: [SessionsModule, ProjectsModule],
  providers: [SkillsRouter, SkillsService, SkillUsageService],
  exports: [SkillsService],
})
export class SkillsModule {}
