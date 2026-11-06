import { Global, Module } from '@nestjs/common'
import { SessionTitler } from '../../../_core/ports/session-titler'
import { ThreadTitlingModule } from './thread-titling.module'
import { ThreadTitlingService } from './thread-titling.service'

@Global()
@Module({
  imports: [ThreadTitlingModule],
  providers: [{ provide: SessionTitler, useExisting: ThreadTitlingService }],
  exports: [SessionTitler],
})
export class SessionTitlerModule {}
