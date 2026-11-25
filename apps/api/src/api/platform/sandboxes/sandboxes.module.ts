import { Module } from '@nestjs/common'
import { NotificationsModule } from '../notifications/notifications.module'
import { ThreadSignalsModule } from '../sessions/thread-signals.module'
import { RetiredSandboxTokenMiddleware } from './retired-sandbox-token.middleware'
import { SandboxCheckpointRouter } from './sandbox-checkpoint.router'
import { SandboxSelfRouter } from './sandbox-self.router'
import { SandboxEndpointService } from './sandbox-endpoint'
import { SandboxesRouter } from './sandboxes.router'
import { SandboxesService } from './sandboxes.service'
import { VercelSandboxClient } from './vercel-sandbox.client'

@Module({
  imports: [ThreadSignalsModule, NotificationsModule],
  providers: [
    SandboxesService,
    SandboxEndpointService,
    SandboxesRouter,
    SandboxCheckpointRouter,
    SandboxSelfRouter,
    RetiredSandboxTokenMiddleware,
    VercelSandboxClient,
  ],
  exports: [SandboxesService, SandboxEndpointService, VercelSandboxClient],
})
export class SandboxesModule {}
