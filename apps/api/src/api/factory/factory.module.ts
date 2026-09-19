import { Module } from '@nestjs/common'
import { TranscriptService } from './transcript.service'
import { WorkItemsService } from './work-items.service'

@Module({
  providers: [WorkItemsService, TranscriptService],
  exports: [WorkItemsService, TranscriptService],
})
export class FactoryModule {}
