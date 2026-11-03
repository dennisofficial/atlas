import { Module } from '@nestjs/common'
import { OauthConnectionsModule } from '../../platform/oauth-connections/oauth-connections.module'
import { ControlPlaneModule } from '../../platform/control/control-plane.module'
import { GithubModule } from '../github/github.module'
import { ScopedConfigModule } from '../scoped-config/scoped-config.module'
import { AgentHostMiddleware } from './agent-host.middleware'
import { AgentHostRouter } from './agent-host.router'
import { AgentHostService } from './agent-host.service'

@Module({
  imports: [ControlPlaneModule, ScopedConfigModule, OauthConnectionsModule, GithubModule],
  providers: [AgentHostService, AgentHostRouter, AgentHostMiddleware],
})
export class AgentHostModule {}
