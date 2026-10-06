import type { OauthTokens, ThreadId } from '@dltech/atlas-core'
import { z } from 'zod'

import type { CloudSession } from './cloud-session'
import { CloudError, CloudTransport } from './cloud-transport'

const OAUTH_ACCESS_TIMEOUT_MS = 30_000
const validInstant = (value: string): boolean => Date.parse(value) > 0

export const oauthAccessResponseSchema = z.object({
  accessToken: z.string().min(1),
  expiresAt: z.string().refine(validInstant, 'expiresAt must be an instant'),
  refreshAfter: z
    .string()
    .refine(validInstant, 'refreshAfter must be an instant')
    .optional(),
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

export type OauthConnectionProvider = 'anthropic' | 'openai'

const malformed = (path: string): CloudError =>
  new CloudError({
    status: 502,
    message: `The Atlas Cloud API answered ${path} with a body that is not an OAuth access response.`,
  })

export class OAuthConnectionsClient {
  private readonly transport: CloudTransport

  constructor(args: {
    url: string
    token: string
    clientVersion?: string | undefined
    fetchFn?: typeof fetch | undefined
  }) {
    this.transport = new CloudTransport(args)
  }

  async handoff(args: {
    connectionId: string
    provider: OauthConnectionProvider
    tokens: OauthTokens
  }): Promise<OauthAccess> {
    const path = connectionPath(args.connectionId)
    const body = await this.transport.request({
      method: 'PUT',
      path,
      body: { provider: args.provider, tokens: args.tokens },
      retry: false,
    })

    return parseAccess({ body, path })
  }

  async reauthorize(args: {
    connectionId: string
    provider: OauthConnectionProvider
    tokens: OauthTokens
    authorizationId: string
    previousAuthorizationId: string
  }): Promise<OauthAccess> {
    const path = `${connectionPath(args.connectionId)}/reauthorize`
    const body = await this.transport.request({
      method: 'PUT',
      path,
      body: {
        provider: args.provider,
        tokens: args.tokens,
        authorizationId: args.authorizationId,
        previousAuthorizationId: args.previousAuthorizationId,
      },
      retry: false,
    })

    return parseAccess({ body, path })
  }

  async metadata(args: { connectionId: string }) {
    const path = connectionPath(args.connectionId)
    const body = await this.transport.request({ method: 'GET', path })
    const parsed = metadataSchema.safeParse(body)
    if (!parsed.success) throw malformed(path)
    return parsed.data
  }

  async accessToken(args: {
    connectionId: string
    rejectedAccessToken?: string | undefined
  }): Promise<OauthAccess> {
    const path = `${connectionPath(args.connectionId)}/access-token`
    const body = await this.transport.request({
      method: 'POST',
      path,
      body: args.rejectedAccessToken === undefined ? {} : { rejectedAccessToken: args.rejectedAccessToken },
      timeoutMs: OAUTH_ACCESS_TIMEOUT_MS,
    })

    return parseAccess({ body, path })
  }

  async assignSandbox(args: { connectionId: string; threadId: ThreadId | string }): Promise<void> {
    await this.transport.request({
      method: 'PUT',
      path: `${connectionPath(args.connectionId)}/sandboxes/${encodeURIComponent(args.threadId)}`,
      retry: false,
    })
  }
}

const connectionPath = (connectionId: string): string =>
  `/v1/oauth-connections/${encodeURIComponent(connectionId)}`

const parseAccess = (args: { body: unknown; path: string }): OauthAccess => {
  const parsed = oauthAccessResponseSchema.safeParse(args.body)
  if (!parsed.success) throw malformed(args.path)

  return parsed.data
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
