import { createApiClient } from '@dltech/atlas-api-router'
import type {
  AgentHostGithubTokenOutput,
  AgentHostModelAccessTokenOutput,
} from '@dltech/atlas-protocol'

export type AgentHostApi = {
  modelAccessToken(args: {
    sessionId: string
    connectionId: string
    rejectedAccessToken?: string | undefined
  }): Promise<AgentHostModelAccessTokenOutput>
  githubToken(args: { sessionId: string }): Promise<AgentHostGithubTokenOutput>
}

export const createAgentHostApi = (args: {
  apiOrigin: string
  agentHostToken: string
  fetchFn?: typeof fetch | undefined
}): AgentHostApi => {
  const client = createApiClient({
    baseUrl: args.apiOrigin,
    token: args.agentHostToken,
    ...(args.fetchFn === undefined ? {} : { fetchFn: args.fetchFn }),
  })
  return {
    modelAccessToken: (input) =>
      client.agentHost.modelAccessToken.query({
        sessionId: input.sessionId,
        connectionId: input.connectionId,
        ...(input.rejectedAccessToken === undefined
          ? {}
          : { rejectedAccessToken: input.rejectedAccessToken }),
      }),
    githubToken: ({ sessionId }) => client.agentHost.githubToken.query({ sessionId }),
  }
}
