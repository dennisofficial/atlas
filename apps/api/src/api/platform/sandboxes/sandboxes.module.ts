import { Module } from '@nestjs/common'
import { ThreadSignalsModule } from '../sessions/thread-signals.module'
import { SandboxCheckpointRouter } from './sandbox-checkpoint.router'
import { SandboxSelfRouter } from './sandbox-self.router'
import { SandboxEndpointService } from './sandbox-endpoint'
import { SandboxTokenMiddleware } from './sandbox-token.middleware'
import { SandboxesRouter } from './sandboxes.router'
import { SandboxesService } from './sandboxes.service'
import { VercelSandboxClient } from './vercel-sandbox.client'

@Module({
  imports: [ThreadSignalsModule],
  providers: [
    SandboxesService,
    SandboxEndpointService,
    SandboxTokenMiddleware,
    SandboxSelfRouter,
    SandboxesRouter,
    SandboxCheckpointRouter,
    VercelSandboxClient,
  ],
  exports: [SandboxesService, SandboxEndpointService, VercelSandboxClient],
})
export class SandboxesModule {}
