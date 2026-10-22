import { Module } from '@nestjs/common'
import { SandboxesModule } from '../../platform/sandboxes/sandboxes.module'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { ScopedConfigModule } from '../scoped-config/scoped-config.module'
import { SandboxProvisioningController } from './sandbox-provisioning.controller'
import { SandboxProvisioningService } from './sandbox-provisioning.service'
import { deliverToServe, SERVE_SEND } from './serve-send'
import { ThreadLauncherModule } from './thread-launcher.module'
import { ThreadMessagesController } from './thread-messages.controller'
import { ThreadMessagesService } from './thread-messages.service'
import { ThreadPodController } from './thread-pod.controller'
import { ThreadPodService } from './thread-pod.service'

@Module({
  imports: [ScopedConfigModule, SandboxesModule, SessionsModule, ThreadLauncherModule],
  controllers: [SandboxProvisioningController, ThreadMessagesController, ThreadPodController],
  providers: [
    SandboxProvisioningService,
    ThreadMessagesService,
    ThreadPodService,
    { provide: SERVE_SEND, useValue: deliverToServe },
  ],
})
export class SandboxProvisioningModule {}
