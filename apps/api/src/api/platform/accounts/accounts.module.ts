import { Module } from '@nestjs/common'
import { AccountLeaseRouter } from './account-lease.router'
import { AccountsRouter } from './accounts.router'
import { AccountsService } from './accounts.service'
import {
  GlobalProviderKeyHttp,
  ProviderKeyCheckService,
  ProviderKeyHttp,
} from './provider-key-check.service'

@Module({
  providers: [
    AccountsService,
    AccountsRouter,
    AccountLeaseRouter,
    { provide: ProviderKeyHttp, useClass: GlobalProviderKeyHttp },
    ProviderKeyCheckService,
  ],
  exports: [AccountsService],
})
export class AccountsModule {}
