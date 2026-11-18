import { z } from 'zod'

export type OAuthFetch = (input: string, init?: RequestInit) => Promise<Response>

export const protectedResourceMetadataSchema = z.object({
  authorization_servers: z.array(z.string()).min(1),
  resource: z.string().optional(),
  scopes_supported: z.array(z.string()).optional(),
})
export type ProtectedResourceMetadata = z.infer<typeof protectedResourceMetadataSchema>

export const authorizationServerMetadataSchema = z.object({
  authorization_endpoint: z.string(),
  token_endpoint: z.string(),
  registration_endpoint: z.string().optional(),
  code_challenge_methods_supported: z.array(z.string()).optional(),
  token_endpoint_auth_methods_supported: z.array(z.string()).optional(),
  scopes_supported: z.array(z.string()).optional(),
})
export type AuthorizationServerMetadata = z.infer<typeof authorizationServerMetadataSchema>

export type WwwAuthenticateChallenge = {
  resourceMetadataUrl?: string
  scope?: string
  error?: string
  errorDescription?: string
}

export const clientInformationSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string().optional(),
  clientIdIssuedAt: z.number().optional(),
  clientSecretExpiresAt: z.number().optional(),
})
export type ClientInformation = z.infer<typeof clientInformationSchema>

export const oauthTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.string().optional(),
  scope: z.string().optional(),
})
export type OAuthTokens = z.infer<typeof oauthTokensSchema>

export const sealedGrantSchema = z.object({
  clientInfo: clientInformationSchema,
  tokens: oauthTokensSchema,
  tokenEndpoint: z.string(),
  authMethods: z.array(z.string()).optional(),
  resource: z.string().optional(),
  redirectUri: z.string(),
})
export type SealedGrant = z.infer<typeof sealedGrantSchema>

export const mcpReturnSurfaceSchema = z.enum(['web', 'desktop', 'ios'])
export type McpReturnSurface = z.infer<typeof mcpReturnSurfaceSchema>

export const mcpReturnScreenSchema = z.union([
  z.strictObject({ kind: z.literal('session'), id: z.string().min(1) }),
  z.strictObject({ kind: z.literal('settings'), scope: z.literal('user') }),
  z.strictObject({
    kind: z.literal('settings'),
    scope: z.literal('project'),
    id: z.string().min(1),
  }),
])
export type McpReturnScreen = z.infer<typeof mcpReturnScreenSchema>

export const mcpReturnTargetSchema = z.strictObject({
  surface: mcpReturnSurfaceSchema,
  screen: mcpReturnScreenSchema,
})
export type McpReturnTarget = z.infer<typeof mcpReturnTargetSchema>

export const sealedPendingSchema = z.object({
  codeVerifier: z.string(),
  clientInfo: clientInformationSchema,
  tokenEndpoint: z.string(),
  authMethods: z.array(z.string()).optional(),
  resource: z.string().optional(),
  redirectUri: z.string(),
  returnTarget: mcpReturnTargetSchema,
})
export type SealedPending = z.infer<typeof sealedPendingSchema>

export const oauthClientSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string().optional(),
})

export type McpServerSource = 'repo' | 'cloud'

export type McpServerGrantRow = {
  id: string
  userId: string | null
  projectId: string | null
  name: string
  source: string
  sealedSpec: string | null
  repoUrl: string | null
  lastSeenAt: Date | null
  oauthServerUrl: string | null
  oauthSealed: string | null
  oauthStatus: string | null
  oauthGeneration: number
  oauthRefreshAttempt: string | null
  oauthRefreshStartedAt: Date | null
  oauthUpdatedAt: Date | null
}

export type PendingRow = {
  id: string
  userId: string
  serverUrl: string
  sealed: string
  returnTo: string
  surface: McpReturnSurface
  expiresAt: Date
  mcpServerId: string | null
}

export type AttemptFence = { id: string; attemptId: string; generation: number }

export type McpOauthBegin =
  | { ok: true; url: string; expiresAt: string }
  | { ok: false; reason: string }

export type McpOauthGrant =
  | { ok: true; accessToken: string; expiresAt: string | null }
  | { ok: false; reason: string }

export type McpOauthServerRef = {
  userId: string
  projectId?: string | undefined
  source: McpServerSource
  name: string
  url: string
}

export type McpOauthBeginArgs = McpOauthServerRef & { returnTarget: McpReturnTarget }

export type McpOauthGateway = {
  begin(args: McpOauthBeginArgs): Promise<McpOauthBegin>
  refresh(args: McpOauthServerRef): Promise<McpOauthGrant>
}

export type McpOauthRuntime = {
  fetch: OAuthFetch
  now: () => number
  allowLocalTargets: boolean
  resolveHost?: ((hostname: string) => Promise<string[]>) | undefined
}
