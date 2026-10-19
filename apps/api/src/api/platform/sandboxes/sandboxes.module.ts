import { Module } from '@nestjs/common'
import { GithubModule } from '../../cloud/github/github.module'
import { SandboxGitCredentials } from './git-credentials'
import { SandboxCheckpointController } from './sandbox-checkpoint.controller'
import { SandboxEndpointService } from './sandbox-endpoint'
import { SandboxTokenGuard } from './sandbox-token.guard'
import { SandboxesController } from './sandboxes.controller'
import { SandboxesService } from './sandboxes.service'
import { VercelSandboxClient } from './vercel-sandbox.client'
import { SandboxWorkspaceController } from './workspace.controller'

@Module({
  imports: [GithubModule],
  controllers: [
    SandboxCheckpointController,
    SandboxesController,
    SandboxWorkspaceController,
  ],
  providers: [SandboxesService, SandboxEndpointService, SandboxTokenGuard, SandboxGitCredentials, VercelSandboxClient],
  exports: [SandboxesService, SandboxEndpointService, SandboxGitCredentials, VercelSandboxClient, SandboxTokenGuard],
})
export class SandboxesModule {}
