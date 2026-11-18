import { Module } from '@nestjs/common'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { SkillCatalogueRouter } from './skill-catalogue.router'
import { SkillCatalogueService } from './skill-catalogue.service'

@Module({
  imports: [SessionsModule],
  providers: [SkillCatalogueRouter, SkillCatalogueService],
})
export class SkillCatalogueModule {}
