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

export const MCP_OAUTH_CALLBACK_PATH = '/v1/mcp/oauth/callback'
export const MCP_OAUTH_RESULT_PARAM = 'mcpOauth'
export const MCP_OAUTH_SERVER_PARAM = 'mcpServer'
export const MCP_OAUTH_REASON_PARAM = 'mcpReason'

const serverUrlSchema = z.url({ protocol: /^https?$/ })
const returnToSchema = z
  .string()
  .regex(/^\/(?![/\\])[^\\\u0000-\u001f\u007f]*$/, 'returnTo must be a same-origin path')
  .max(512)

export const mcpOauthBeginInputSchema = z.strictObject({
  serverUrl: serverUrlSchema,
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

export const mcpOauthStatusInputSchema = z.strictObject({
  serverUrls: z.array(serverUrlSchema).max(100),
})
export type McpOauthStatusInput = z.infer<typeof mcpOauthStatusInputSchema>

export const mcpOauthGrantSchema = z.strictObject({
  serverUrl: z.string(),
  status: z.enum(EMcpOauthGrantStatus),
  updatedAt: z.string().optional(),
})
export type McpOauthGrant = z.infer<typeof mcpOauthGrantSchema>

export const mcpOauthStatusResultSchema = z.strictObject({
  grants: z.array(mcpOauthGrantSchema),
})
export type McpOauthStatusResult = z.infer<typeof mcpOauthStatusResultSchema>

export const mcpOauthServerRefSchema = z.strictObject({ serverUrl: serverUrlSchema })
export type McpOauthServerRef = z.infer<typeof mcpOauthServerRefSchema>

export const mcpOauthAccessInputSchema = z.strictObject({
  serverUrl: serverUrlSchema,
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
