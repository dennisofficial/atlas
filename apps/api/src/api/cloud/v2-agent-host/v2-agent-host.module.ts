import { Module } from '@nestjs/common'
import { OauthConnectionsModule } from '../../platform/oauth-connections/oauth-connections.module'
import { V2ControlModule } from '../../platform/v2/v2-control.module'
import { GithubModule } from '../github/github.module'
import { ScopedConfigModule } from '../scoped-config/scoped-config.module'
import { V2AgentHostMiddleware } from './v2-agent-host.middleware'
import { V2AgentHostRouter } from './v2-agent-host.router'
import { V2AgentHostService } from './v2-agent-host.service'

@Module({
  imports: [V2ControlModule, ScopedConfigModule, OauthConnectionsModule, GithubModule],
  providers: [V2AgentHostService, V2AgentHostRouter, V2AgentHostMiddleware],
})
export class V2AgentHostModule {}
