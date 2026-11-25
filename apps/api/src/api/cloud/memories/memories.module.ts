import { Module } from '@nestjs/common'
import { MemoriesRouter } from './memories.router'
import { MemoriesService } from './memories.service'

@Module({
  providers: [MemoriesRouter, MemoriesService],
})
export class MemoriesModule {}
