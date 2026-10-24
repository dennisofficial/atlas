import { Module } from '@nestjs/common'
import { SandboxesModule } from '../sandboxes/sandboxes.module'
import { EventsService } from './events.service'
import { SessionOrSandboxMiddleware } from './session-or-sandbox.middleware'
import { ThreadArchiveService } from './thread-archive.service'
import { ThreadEventsRouter } from './thread-events.router'
import { ThreadTurnsRouter } from './thread-turns.router'
import { ThreadsHistoryService } from './threads-history.service'
import { ThreadsRouter } from './threads.router'
import { ThreadsService } from './threads.service'
import { TurnsService } from './turns.service'

@Module({
  imports: [SandboxesModule],
  providers: [
    ThreadsService,
    ThreadArchiveService,
    ThreadsHistoryService,
    EventsService,
    TurnsService,
    ThreadsRouter,
    ThreadEventsRouter,
    ThreadTurnsRouter,
    SessionOrSandboxMiddleware,
  ],
  exports: [SessionOrSandboxMiddleware, SandboxesModule, ThreadsService],
})
export class SessionsModule {}
