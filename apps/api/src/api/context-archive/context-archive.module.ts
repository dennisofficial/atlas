import { Module } from '@nestjs/common'
import { CONTEXT_ARCHIVE_STORE } from './context-archive.store'
import { PrismaContextArchiveStore } from './prisma-context-archive.store'

@Module({
  providers: [{ provide: CONTEXT_ARCHIVE_STORE, useClass: PrismaContextArchiveStore }],
  exports: [CONTEXT_ARCHIVE_STORE],
})
export class ContextArchiveModule {}
