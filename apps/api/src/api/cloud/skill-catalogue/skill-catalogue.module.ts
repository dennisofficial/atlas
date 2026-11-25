import { Module } from '@nestjs/common'
import { SkillCatalogueRouter } from './skill-catalogue.router'
import { SkillCatalogueService } from './skill-catalogue.service'

@Module({
  providers: [SkillCatalogueRouter, SkillCatalogueService],
})
export class SkillCatalogueModule {}
