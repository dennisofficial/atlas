import { Module } from '@nestjs/common'
import { EventsController } from './events.controller'
import { EventsService } from './events.service'
import { ThreadsController } from './threads.controller'
import { ThreadsHistoryService } from './threads-history.service'
import { ThreadsService } from './threads.service'
import { TurnsController } from './turns.controller'
import { TurnsService } from './turns.service'

@Module({
  controllers: [ThreadsController, EventsController, TurnsController],
  providers: [ThreadsService, ThreadsHistoryService, EventsService, TurnsService],
})
export class SessionsModule {}
