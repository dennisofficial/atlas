import { Module } from '@nestjs/common'
import { HealthModule } from '../health/health.module'
import { SandboxesModule } from '../sandboxes/sandboxes.module'
import { EventsService } from './events.service'
import { SessionsRouter } from './sessions.router'
import { SessionsService } from './sessions.service'
import { SessionOrSandboxMiddleware } from './session-or-sandbox.middleware'
import { ThreadArchiveService } from './thread-archive.service'
import { ThreadEventsRouter } from './thread-events.router'
import { ThreadReadService } from './thread-read.service'
import { ThreadSignalsModule } from './thread-signals.module'
import { ThreadTurnsRouter } from './thread-turns.router'
import { ThreadsHistoryService } from './threads-history.service'
import { ThreadsRouter } from './threads.router'
import { ThreadsService } from './threads.service'
import { TurnsService } from './turns.service'

@Module({
  imports: [SandboxesModule, HealthModule, ThreadSignalsModule],
  providers: [
    ThreadsService,
    ThreadArchiveService,
    ThreadReadService,
    ThreadsHistoryService,
    EventsService,
    TurnsService,
    ThreadsRouter,
    SessionsService,
    SessionsRouter,
    ThreadEventsRouter,
    ThreadTurnsRouter,
    SessionOrSandboxMiddleware,
  ],
  exports: [SessionOrSandboxMiddleware, SandboxesModule, ThreadsService, ThreadSignalsModule],
})
export class SessionsModule {}
