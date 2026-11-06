import { Module } from '@nestjs/common'
import { PgRefreshLock } from './pg-refresh-lock'
import { RefreshLock } from './refresh-lock'

@Module({
  providers: [{ provide: RefreshLock, useClass: PgRefreshLock }],
  exports: [RefreshLock],
})
export class RefreshLockModule {}
