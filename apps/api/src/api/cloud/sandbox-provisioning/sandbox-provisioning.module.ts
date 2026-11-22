import { Module } from '@nestjs/common'
import { backgroundWorkProvider } from '../../../_lib/background-work/background-work.providers'
import { SandboxTokenMiddleware } from '../../platform/sandboxes/sandbox-token.middleware'
import { SandboxesModule } from '../../platform/sandboxes/sandboxes.module'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { ScopedConfigModule } from '../scoped-config/scoped-config.module'
import { SandboxRolloverRouter } from './sandbox-rollover.router'
import { SandboxProvisioningRouter } from './sandbox-provisioning.router'
import { SandboxProvisioningService } from './sandbox-provisioning.service'
import { ThreadLauncherModule } from './thread-launcher.module'
import { ThreadMessagesRouter } from './thread-messages.router'
import { ThreadMessagesService } from './thread-messages.service'
import { ThreadPodRouter } from './thread-pod.router'
import { ThreadPodService } from './thread-pod.service'

@Module({
  imports: [ScopedConfigModule, SandboxesModule, SessionsModule, ThreadLauncherModule],
  providers: [
    SandboxProvisioningService,
    ThreadMessagesService,
    ThreadPodService,
    backgroundWorkProvider(),
    SandboxProvisioningRouter,
    ThreadMessagesRouter,
    ThreadPodRouter,
    SandboxRolloverRouter,
    SandboxTokenMiddleware,
  ],
})
export class SandboxProvisioningModule {}
