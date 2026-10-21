import { Module } from '@nestjs/common'
import { SandboxCheckpointController } from './sandbox-checkpoint.controller'
import { SandboxSelfController } from './sandbox-self.controller'
import { SandboxEndpointService } from './sandbox-endpoint'
import { SandboxTokenGuard } from './sandbox-token.guard'
import { SandboxesController } from './sandboxes.controller'
import { SandboxesService } from './sandboxes.service'
import { VercelSandboxClient } from './vercel-sandbox.client'

@Module({
  controllers: [SandboxCheckpointController, SandboxSelfController, SandboxesController],
  providers: [SandboxesService, SandboxEndpointService, SandboxTokenGuard, VercelSandboxClient],
  exports: [SandboxesService, SandboxEndpointService, VercelSandboxClient, SandboxTokenGuard],
})
export class SandboxesModule {}
