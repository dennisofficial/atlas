import { Module } from '@nestjs/common'
import { SandboxesModule } from '../sandboxes/sandboxes.module'
import { HostSelfRouter } from './host-self.router'
import { HostTokenMiddleware } from './host-token.middleware'

@Module({
  imports: [SandboxesModule],
  providers: [HostSelfRouter, HostTokenMiddleware],
})
export class HostModule {}
