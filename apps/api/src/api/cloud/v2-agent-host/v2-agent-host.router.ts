import { Ctx, Input, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import {
  v2AgentHostConfigInputSchema,
  v2AgentHostConfigOutputSchema,
  v2AgentHostGithubTokenInputSchema,
  v2AgentHostGithubTokenOutputSchema,
  v2AgentHostModelAccessTokenInputSchema,
  v2AgentHostModelAccessTokenOutputSchema,
  type V2AgentHostConfigInput,
  type V2AgentHostConfigOutput,
  type V2AgentHostGithubTokenInput,
  type V2AgentHostGithubTokenOutput,
  type V2AgentHostModelAccessTokenInput,
  type V2AgentHostModelAccessTokenOutput,
} from '@dltech/atlas-protocol'
import { meta } from '../../../_module/trpc/procedure-meta'
import { V2AgentHostMiddleware } from './v2-agent-host.middleware'
import { V2AgentHostService } from './v2-agent-host.service'

@Router({ alias: 'v2AgentHost' })
@UseMiddlewares(V2AgentHostMiddleware)
export class V2AgentHostRouter {
  constructor(private readonly agentHost: V2AgentHostService) {}

  @Query({
    input: v2AgentHostConfigInputSchema,
    output: v2AgentHostConfigOutputSchema,
    meta: meta({ throttle: false }),
  })
  config(@Input() input: V2AgentHostConfigInput): Promise<V2AgentHostConfigOutput> {
    return this.agentHost.config({ sessionId: input.sessionId })
  }

  @Query({
    input: v2AgentHostModelAccessTokenInputSchema,
    output: v2AgentHostModelAccessTokenOutputSchema,
    meta: meta({ throttle: false }),
  })
  modelAccessToken(
    @Input() input: V2AgentHostModelAccessTokenInput,
  ): Promise<V2AgentHostModelAccessTokenOutput> {
    return this.agentHost.modelAccessToken(input)
  }

  @Query({
    input: v2AgentHostGithubTokenInputSchema,
    output: v2AgentHostGithubTokenOutputSchema,
    meta: meta({ throttle: false }),
  })
  githubToken(@Input() input: V2AgentHostGithubTokenInput): Promise<V2AgentHostGithubTokenOutput> {
    return this.agentHost.githubToken({ sessionId: input.sessionId })
  }
}
