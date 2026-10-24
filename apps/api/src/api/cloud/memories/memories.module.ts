import { Module } from '@nestjs/common'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { MemoriesRouter } from './memories.router'
import { MemoriesService } from './memories.service'

@Module({
  imports: [SessionsModule],
  providers: [MemoriesRouter, MemoriesService],
})
export class MemoriesModule {}
