import { z } from 'zod'

export enum EMcpOauthGrantStatus {
  Connected = 'connected',
  Expired = 'expired',
  None = 'none',
}

export enum EMcpOauthBeginOutcome {
  Redirect = 'redirect',
  Unsupported = 'unsupported',
}

export enum EMcpOauthAccessOutcome {
  Granted = 'granted',
  NeedsAuth = 'needs-auth',
}

export enum EMcpOauthCallbackResult {
  Connected = 'connected',
  Failed = 'failed',
}

export enum EMcpServerSource {
  Cloud = 'cloud',
  Repo = 'repo',
}

export const MCP_OAUTH_CALLBACK_PATH = '/v1/mcp/oauth/callback'
export const MCP_OAUTH_RESULT_PARAM = 'mcpOauth'
export const MCP_OAUTH_SERVER_PARAM = 'mcpServer'
export const MCP_OAUTH_REASON_PARAM = 'mcpReason'

const serverUrlSchema = z.url({ protocol: /^https?$/ })
const returnToSchema = z
  .string()
  .regex(/^\/(?![/\\])[^\\\u0000-\u001f\u007f]*$/, 'returnTo must be a same-origin path')
  .max(512)

export const mcpOauthServerRefSchema = z.strictObject({ serverId: z.string().min(1) })
export type McpOauthServerRef = z.infer<typeof mcpOauthServerRefSchema>

export const mcpOauthBeginInputSchema = mcpOauthServerRefSchema.extend({
  returnTo: returnToSchema.optional(),
})
export type McpOauthBeginInput = z.infer<typeof mcpOauthBeginInputSchema>

export const mcpOauthBeginResultSchema = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.literal(EMcpOauthBeginOutcome.Redirect),
    authorizationUrl: z.url(),
  }),
  z.strictObject({
    outcome: z.literal(EMcpOauthBeginOutcome.Unsupported),
    reason: z.string(),
  }),
])
export type McpOauthBeginResult = z.infer<typeof mcpOauthBeginResultSchema>

export const mcpOauthServersInputSchema = z.strictObject({
  projectId: z.string().min(1).optional(),
})
export type McpOauthServersInput = z.infer<typeof mcpOauthServersInputSchema>

export const mcpOauthServerSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  source: z.enum(EMcpServerSource),
  url: z.string(),
  status: z.enum(EMcpOauthGrantStatus),
  signedInAt: z.string().optional(),
  lastSeenAt: z.string().optional(),
})
export type McpOauthServer = z.infer<typeof mcpOauthServerSchema>

export const mcpOauthServersResultSchema = z.strictObject({
  servers: z.array(mcpOauthServerSchema),
})
export type McpOauthServersResult = z.infer<typeof mcpOauthServersResultSchema>

export const mcpOauthAccessInputSchema = z.strictObject({
  name: z.string().min(1),
  source: z.enum(EMcpServerSource),
  url: serverUrlSchema,
  rejectedAccessToken: z.string().min(1).optional(),
})
export type McpOauthAccessInput = z.infer<typeof mcpOauthAccessInputSchema>

export const mcpOauthAccessResultSchema = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.literal(EMcpOauthAccessOutcome.Granted),
    accessToken: z.string().min(1),
    expiresAt: z.string().optional(),
  }),
  z.strictObject({ outcome: z.literal(EMcpOauthAccessOutcome.NeedsAuth) }),
])
export type McpOauthAccessResult = z.infer<typeof mcpOauthAccessResultSchema>
