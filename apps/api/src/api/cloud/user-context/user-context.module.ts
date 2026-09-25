import { Module } from '@nestjs/common'
import { ContextArchiveModule } from '../context-archive/context-archive.module'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { USER_MEMORY_ENTRY_STORE } from './memory-entry.store'
import { PrismaUserMemoryEntryStore } from './prisma-memory-entry.store'
import { UserContextController } from './user-context.controller'
import { UserContextService } from './user-context.service'

@Module({
  imports: [ContextArchiveModule, SessionsModule],
  controllers: [UserContextController],
  providers: [
    UserContextService,
    { provide: USER_MEMORY_ENTRY_STORE, useClass: PrismaUserMemoryEntryStore },
  ],
})
export class UserContextModule {}
