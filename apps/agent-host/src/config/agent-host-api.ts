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

type Cached = { value: AgentHostConfigOutput; expiresAtMs: number; refreshAfterMs: number }

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
  const inflight = new Map<string, Promise<AgentHostConfigOutput>>()

  const config = async ({ sessionId }: { sessionId: string }): Promise<AgentHostConfigOutput> => {
    const cached = cache.get(sessionId)
    if (cached !== undefined && now() < cached.refreshAfterMs) return cached.value
    const pending = inflight.get(sessionId)
    if (pending !== undefined) return pending
    const request = refresh({ sessionId, cached })
      .catch((error: unknown) => {
        if (cached !== undefined && now() < cached.expiresAtMs) return cached.value
        throw error
      })
      .finally(() => {
        inflight.delete(sessionId)
      })
    inflight.set(sessionId, request)
    return request
  }

  const refresh = async (args: {
    sessionId: string
    cached: Cached | undefined
  }): Promise<AgentHostConfigOutput> => {
    const fresh = await client.agentHost.config.query({ sessionId: args.sessionId })
    const expiresAtMs = Date.parse(fresh.expiresAt)
    cache.set(args.sessionId, {
      value: fresh,
      expiresAtMs,
      refreshAfterMs: now() + (expiresAtMs - now()) / 2,
    })
    return fresh
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
