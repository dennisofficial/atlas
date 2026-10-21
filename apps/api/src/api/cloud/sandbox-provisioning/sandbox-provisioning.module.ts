import { Module } from '@nestjs/common'
import { backgroundWorkProvider } from '../../../_lib/background-work/background-work.providers'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { sandboxWakeBootProvider } from '../github/github-sandbox-wake-boot'
import { ScopedConfigModule } from '../scoped-config/scoped-config.module'
import { SandboxProvisioningController } from './sandbox-provisioning.controller'
import { SandboxProvisioningService } from './sandbox-provisioning.service'

@Module({
  imports: [ScopedConfigModule, SessionsModule],
  controllers: [SandboxProvisioningController],
  providers: [SandboxProvisioningService, sandboxWakeBootProvider, backgroundWorkProvider()],
})
export class SandboxProvisioningModule {}
