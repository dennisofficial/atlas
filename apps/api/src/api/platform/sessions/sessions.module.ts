import { Module } from '@nestjs/common'
import { SandboxesModule } from '../sandboxes/sandboxes.module'
import { EventsController } from './events.controller'
import { EventsService } from './events.service'
import { SessionOrSandboxGuard } from './session-or-sandbox.guard'
import { SessionOrSandboxMiddleware } from './session-or-sandbox.middleware'
import { ThreadsController } from './threads.controller'
import { ThreadsHistoryService } from './threads-history.service'
import { ThreadsService } from './threads.service'
import { TurnsController } from './turns.controller'
import { TurnsService } from './turns.service'

@Module({
  imports: [SandboxesModule],
  controllers: [ThreadsController, EventsController, TurnsController],
  providers: [
    ThreadsService,
    ThreadsHistoryService,
    EventsService,
    TurnsService,
    SessionOrSandboxGuard,
    SessionOrSandboxMiddleware,
  ],
  exports: [SessionOrSandboxGuard, SessionOrSandboxMiddleware, SandboxesModule, ThreadsService],
})
export class SessionsModule {}
