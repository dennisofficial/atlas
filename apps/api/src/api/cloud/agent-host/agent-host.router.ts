import { Input, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import {
  agentHostConfigInputSchema,
  agentHostConfigOutputSchema,
  agentHostGithubTokenInputSchema,
  agentHostGithubTokenOutputSchema,
  agentHostModelAccessTokenInputSchema,
  agentHostModelAccessTokenOutputSchema,
  type AgentHostConfigInput,
  type AgentHostConfigOutput,
  type AgentHostGithubTokenInput,
  type AgentHostGithubTokenOutput,
  type AgentHostModelAccessTokenInput,
  type AgentHostModelAccessTokenOutput,
} from '@dltech/atlas-protocol'
import { meta } from '../../../_module/trpc/procedure-meta'
import { AgentHostMiddleware } from './agent-host.middleware'
import { AgentHostService } from './agent-host.service'

@Router({ alias: 'agentHost' })
@UseMiddlewares(AgentHostMiddleware)
export class AgentHostRouter {
  constructor(private readonly agentHost: AgentHostService) {}

  @Query({
    input: agentHostConfigInputSchema,
    output: agentHostConfigOutputSchema,
    meta: meta({ throttle: false }),
  })
  config(@Input() input: AgentHostConfigInput): Promise<AgentHostConfigOutput> {
    return this.agentHost.config({ sessionId: input.sessionId })
  }

  @Query({
    input: agentHostModelAccessTokenInputSchema,
    output: agentHostModelAccessTokenOutputSchema,
    meta: meta({ throttle: false }),
  })
  modelAccessToken(
    @Input() input: AgentHostModelAccessTokenInput,
  ): Promise<AgentHostModelAccessTokenOutput> {
    return this.agentHost.modelAccessToken(input)
  }

  @Query({
    input: agentHostGithubTokenInputSchema,
    output: agentHostGithubTokenOutputSchema,
    meta: meta({ throttle: false }),
  })
  githubToken(@Input() input: AgentHostGithubTokenInput): Promise<AgentHostGithubTokenOutput> {
    return this.agentHost.githubToken({ sessionId: input.sessionId })
  }
}
