import { Module } from '@nestjs/common'
import { SandboxCheckpointController } from './sandbox-checkpoint.controller'
import { SandboxSelfRouter } from './sandbox-self.router'
import { SandboxEndpointService } from './sandbox-endpoint'
import { SandboxTokenGuard } from './sandbox-token.guard'
import { SandboxTokenMiddleware } from './sandbox-token.middleware'
import { SandboxesController } from './sandboxes.controller'
import { SandboxesService } from './sandboxes.service'
import { VercelSandboxClient } from './vercel-sandbox.client'

@Module({
  controllers: [SandboxCheckpointController, SandboxesController],
  providers: [
    SandboxesService,
    SandboxEndpointService,
    SandboxTokenGuard,
    SandboxTokenMiddleware,
    SandboxSelfRouter,
    VercelSandboxClient,
  ],
  exports: [SandboxesService, SandboxEndpointService, VercelSandboxClient, SandboxTokenGuard],
})
export class SandboxesModule {}
