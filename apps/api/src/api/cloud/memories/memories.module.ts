import { Module } from '@nestjs/common'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { MemoriesController } from './memories.controller'
import { MemoriesService } from './memories.service'

@Module({
  imports: [SessionsModule],
  controllers: [MemoriesController],
  providers: [MemoriesService],
})
export class MemoriesModule {}
