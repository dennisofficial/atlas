import type { OauthTokens, ThreadId } from '@dltech/atlas-core'
import type { ApiClient } from '@dltech/atlas-api-router'
import { EOauthProvider } from '@dltech/atlas-wire'
import { z } from 'zod'

import { cloudCall, createHarnessApiClient } from './api-trpc-client'
import type { CloudSession } from './cloud-session'
import { CloudError, DEFAULT_REQUEST_TIMEOUT_MS } from './cloud-transport'

const OAUTH_ACCESS_TIMEOUT_MS = 30_000
const validInstant = (value: string): boolean => Date.parse(value) > 0

export const oauthAccessResponseSchema = z.object({
  accessToken: z.string().min(1),
  expiresAt: z.string().refine(validInstant, 'expiresAt must be an instant'),
  refreshAfter: z.string().refine(validInstant, 'refreshAfter must be an instant').optional(),
  generation: z.number().int().nonnegative(),
  authorizationId: z.string().min(1).optional(),
  providerAccountId: z.string().optional(),
})

export type OauthAccess = z.infer<typeof oauthAccessResponseSchema>

const metadataSchema = z.object({
  provider: z.string().min(1),
  authorizationId: z.string().min(1),
  generation: z.number().int().nonnegative(),
})

export type OauthConnectionProvider = EOauthProvider

const malformed = (procedure: string): CloudError =>
  new CloudError({
    status: 502,
    message: `The Atlas Cloud API answered ${procedure} with a body that is not an OAuth access response.`,
  })

const parseAccess = (args: { body: unknown; procedure: string }): OauthAccess => {
  const parsed = oauthAccessResponseSchema.safeParse(args.body)
  if (!parsed.success) throw malformed(args.procedure)

  return parsed.data
}

const signalFor = (timeoutMs: number): { signal: AbortSignal } => ({
  signal: AbortSignal.timeout(timeoutMs),
})

export class OAuthConnectionsClient {
  private readonly api: ApiClient

  constructor(args: {
    url: string
    token: string
    clientVersion?: string | undefined
    fetchFn?: typeof fetch | undefined
  }) {
    this.api = createHarnessApiClient({
      url: args.url,
      token: args.token,
      clientVersion: args.clientVersion ?? 'dev',
      fetchFn: args.fetchFn ?? fetch,
      timeoutMs: null,
    })
  }

  async handoff(args: {
    connectionId: string
    provider: OauthConnectionProvider
    tokens: OauthTokens
  }): Promise<OauthAccess> {
    const body = await cloudCall(
      this.api.oauthConnections.upload.mutate(
        { connectionId: args.connectionId, provider: args.provider, tokens: args.tokens },
        signalFor(DEFAULT_REQUEST_TIMEOUT_MS),
      ),
    )

    return parseAccess({ body, procedure: 'oauthConnections.upload' })
  }

  async reauthorize(args: {
    connectionId: string
    provider: OauthConnectionProvider
    tokens: OauthTokens
    authorizationId: string
    previousAuthorizationId: string
  }): Promise<OauthAccess> {
    const body = await cloudCall(
      this.api.oauthConnections.reauthorize.mutate(
        {
          connectionId: args.connectionId,
          provider: args.provider,
          tokens: args.tokens,
          authorizationId: args.authorizationId,
          previousAuthorizationId: args.previousAuthorizationId,
        },
        signalFor(DEFAULT_REQUEST_TIMEOUT_MS),
      ),
    )

    return parseAccess({ body, procedure: 'oauthConnections.reauthorize' })
  }

  async metadata(args: { connectionId: string }) {
    const body = await cloudCall(
      this.api.oauthConnections.get.query(
        { connectionId: args.connectionId },
        signalFor(DEFAULT_REQUEST_TIMEOUT_MS),
      ),
    )
    const parsed = metadataSchema.safeParse(body)
    if (!parsed.success) throw malformed('oauthConnections.get')
    return parsed.data
  }

  async accessToken(args: {
    connectionId: string
    rejectedAccessToken?: string | undefined
  }): Promise<OauthAccess> {
    const body = await cloudCall(
      this.api.oauthConnections.accessToken.mutate(
        {
          connectionId: args.connectionId,
          ...(args.rejectedAccessToken === undefined
            ? {}
            : { rejectedAccessToken: args.rejectedAccessToken }),
        },
        signalFor(OAUTH_ACCESS_TIMEOUT_MS),
      ),
    )

    return parseAccess({ body, procedure: 'oauthConnections.accessToken' })
  }

  async assignSandbox(args: { connectionId: string; threadId: ThreadId | string }): Promise<void> {
    await cloudCall(
      this.api.oauthConnections.assignSandbox.mutate(
        { connectionId: args.connectionId, threadId: args.threadId },
        signalFor(DEFAULT_REQUEST_TIMEOUT_MS),
      ),
    )
  }
}

export const oauthConnectionsClientFor = (args: {
  session: CloudSession
  clientVersion?: string | undefined
  fetchFn?: typeof fetch | undefined
}): OAuthConnectionsClient =>
  new OAuthConnectionsClient({
    url: args.session.url,
    token: args.session.token,
    clientVersion: args.clientVersion,
    fetchFn: args.fetchFn,
  })
