import { Global, Module } from '@nestjs/common'
import { ClientVersionGuard } from './client-version.guard'

@Global()
@Module({
  providers: [ClientVersionGuard],
  exports: [ClientVersionGuard],
})
export class ClientVersionModule {}
