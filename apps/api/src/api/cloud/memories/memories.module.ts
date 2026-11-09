import { Module } from '@nestjs/common'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { HostMemoryRouter } from './host-memory.router'
import { MemoriesRouter } from './memories.router'
import { MemoriesService } from './memories.service'

@Module({
  imports: [SessionsModule],
  providers: [MemoriesRouter, HostMemoryRouter, MemoriesService],
})
export class MemoriesModule {}
