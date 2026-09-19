import { Module } from '@nestjs/common'
import { GithubModule } from '../github/github.module'
import { SandboxExposeController } from './expose.controller'
import { SandboxHeartbeatController } from './heartbeat.controller'
import { SandboxReaperService } from './sandbox-reaper.service'
import { SandboxTokenGuard } from './sandbox-token.guard'
import { SandboxesController } from './sandboxes.controller'
import { SandboxesService } from './sandboxes.service'
import { ServeBinaryService } from './serve-binary'
import { ServeBinaryController } from './serve-binary.controller'
import { VercelSandboxClient } from './vercel-sandbox.client'
import { SandboxWorkspaceController } from './workspace.controller'

@Module({
  imports: [GithubModule],
  controllers: [
    SandboxesController,
    SandboxHeartbeatController,
    SandboxWorkspaceController,
    ServeBinaryController,
    SandboxExposeController,
  ],
  providers: [
    SandboxesService,
    SandboxReaperService,
    SandboxTokenGuard,
    ServeBinaryService,
    VercelSandboxClient,
  ],
  exports: [SandboxesService],
})
export class SandboxesModule {}
