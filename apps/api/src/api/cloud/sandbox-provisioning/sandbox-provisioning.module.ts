import { Module } from '@nestjs/common'
import { backgroundWorkProvider } from '../../../_lib/background-work/background-work.providers'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { sandboxWakeBootProvider } from '../github/github-sandbox-wake-boot'
import { ScopedConfigModule } from '../scoped-config/scoped-config.module'
import { SandboxProvisioningController } from './sandbox-provisioning.controller'
import { SandboxProvisioningService } from './sandbox-provisioning.service'
import { deliverToServe, SERVE_SEND } from './serve-send'
import { ThreadMessagesController } from './thread-messages.controller'
import { ThreadMessagesService } from './thread-messages.service'
import { ThreadPodController } from './thread-pod.controller'
import { ThreadPodService } from './thread-pod.service'

@Module({
  imports: [ScopedConfigModule, SessionsModule],
  controllers: [SandboxProvisioningController, ThreadMessagesController, ThreadPodController],
  providers: [
    SandboxProvisioningService,
    ThreadMessagesService,
    ThreadPodService,
    { provide: SERVE_SEND, useValue: deliverToServe },
    sandboxWakeBootProvider,
    backgroundWorkProvider(),
  ],
})
export class SandboxProvisioningModule {}
