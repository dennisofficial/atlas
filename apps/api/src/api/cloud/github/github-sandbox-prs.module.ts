import { Module } from '@nestjs/common'
import { SandboxesModule } from '../../platform/sandboxes/sandboxes.module'
import { GithubModule } from './github.module'
import { SandboxPullRequestsController } from './sandbox-pull-requests.controller'

/**
 * Same split as GithubWebhooksModule: SandboxesModule already imports GithubModule, so a
 * controller that needs both the sandbox guard and the pull-request reads cannot live in either
 * without closing a module cycle.
 */
@Module({
  imports: [GithubModule, SandboxesModule],
  controllers: [SandboxPullRequestsController],
})
export class GithubSandboxPrsModule {}
