import { Module } from '@nestjs/common'
import { ProjectsModule } from '../projects/projects.module'
import { AccessGrantsRouter } from './access-grants.router'
import { AccessGrantsService } from './access-grants.service'

@Module({
  imports: [ProjectsModule],
  providers: [AccessGrantsRouter, AccessGrantsService],
})
export class AccessGrantsModule {}
