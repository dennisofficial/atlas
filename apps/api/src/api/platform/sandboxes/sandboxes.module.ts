import { Module } from '@nestjs/common'
import { ContextArchiveModule } from '../../cloud/context-archive/context-archive.module'
import { GithubModule } from '../../cloud/github/github.module'
import { SandboxGitCredentials } from './git-credentials'
import { SandboxContextController } from './sandbox-context.controller'
import { SandboxTokenGuard } from './sandbox-token.guard'
import { SandboxesController } from './sandboxes.controller'
import { SandboxesService } from './sandboxes.service'
import { VercelSandboxClient } from './vercel-sandbox.client'
import { SandboxWorkspaceController } from './workspace.controller'

@Module({
  imports: [ContextArchiveModule, GithubModule],
  controllers: [SandboxContextController, SandboxesController, SandboxWorkspaceController],
  providers: [SandboxesService, SandboxTokenGuard, SandboxGitCredentials, VercelSandboxClient],
  exports: [SandboxesService, SandboxGitCredentials, VercelSandboxClient, SandboxTokenGuard],
})
export class SandboxesModule {}
