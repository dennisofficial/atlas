import { createApiClient } from '@dltech/atlas-api-router'
import type {
  AgentHostConfigOutput,
  AgentHostGithubTokenOutput,
  AgentHostModelAccessTokenOutput,
} from '@dltech/atlas-protocol'

export type AgentHostApi = {
  config(args: { sessionId: string }): Promise<AgentHostConfigOutput>
  modelAccessToken(args: {
    sessionId: string
    connectionId: string
    rejectedAccessToken?: string | undefined
  }): Promise<AgentHostModelAccessTokenOutput>
  githubToken(args: { sessionId: string }): Promise<AgentHostGithubTokenOutput>
}

type Cached = { value: AgentHostConfigOutput; expiresAtMs: number }

export const createAgentHostApi = (args: {
  apiOrigin: string
  agentHostToken: string
  fetchFn?: typeof fetch | undefined
  now?: (() => number) | undefined
}): AgentHostApi => {
  const client = createApiClient({
    baseUrl: args.apiOrigin,
    token: args.agentHostToken,
    ...(args.fetchFn === undefined ? {} : { fetchFn: args.fetchFn }),
  })
  const now = args.now ?? Date.now
  const cache = new Map<string, Cached>()

  const config = async ({ sessionId }: { sessionId: string }): Promise<AgentHostConfigOutput> => {
    const cached = cache.get(sessionId)
    if (cached !== undefined && now() < cached.expiresAtMs) return cached.value
    try {
      const fresh = await client.agentHost.config.query({ sessionId })
      cache.set(sessionId, { value: fresh, expiresAtMs: Date.parse(fresh.expiresAt) })
      return fresh
    } catch (error) {
      if (cached !== undefined) return cached.value
      throw error
    }
  }

  return {
    config,
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
