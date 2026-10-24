import { z } from 'zod'

export enum EOauthProvider {
  Anthropic = 'anthropic',
  OpenAI = 'openai',
}

export const oauthGrantTokensSchema = z.strictObject({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.iso.datetime({ offset: true }),
  scopes: z.array(z.string()).optional(),
  accountId: z.string().optional(),
})
export type OauthGrantTokens = z.infer<typeof oauthGrantTokensSchema>

export const uploadConnectionDraftSchema = z.strictObject({
  provider: z.enum(EOauthProvider),
  tokens: oauthGrantTokensSchema,
})
export type UploadConnectionDraft = z.infer<typeof uploadConnectionDraftSchema>

export const reauthorizeConnectionDraftSchema = uploadConnectionDraftSchema.extend({
  authorizationId: z.string().min(1),
  previousAuthorizationId: z.string().min(1),
})
export type ReauthorizeConnectionDraft = z.infer<typeof reauthorizeConnectionDraftSchema>

export const oauthConnectionIdSchema = z.string().min(1)

export const uploadConnectionInputSchema = uploadConnectionDraftSchema.extend({
  connectionId: oauthConnectionIdSchema,
})
export type UploadConnectionInput = z.infer<typeof uploadConnectionInputSchema>

export const reauthorizeConnectionInputSchema = reauthorizeConnectionDraftSchema.extend({
  connectionId: oauthConnectionIdSchema,
})
export type ReauthorizeConnectionInput = z.infer<typeof reauthorizeConnectionInputSchema>

export const connectionRefSchema = z.strictObject({ connectionId: oauthConnectionIdSchema })
export type ConnectionRef = z.infer<typeof connectionRefSchema>

export const oauthAccessTokenRequestSchema = z.strictObject({
  connectionId: oauthConnectionIdSchema,
  rejectedAccessToken: z.string().optional(),
})
export type OauthAccessTokenRequest = z.infer<typeof oauthAccessTokenRequestSchema>

export const assignConnectionSandboxSchema = z.strictObject({
  connectionId: oauthConnectionIdSchema,
  threadId: z.string().min(1),
})
export type AssignConnectionSandbox = z.infer<typeof assignConnectionSandboxSchema>

export const oauthAccessTokenSchema = z.object({
  accessToken: z.string(),
  expiresAt: z.string(),
  refreshAfter: z.string(),
  generation: z.number().int(),
  authorizationId: z.string(),
  providerAccountId: z.string().optional(),
})
export type OauthAccessToken = z.infer<typeof oauthAccessTokenSchema>

export const oauthConnectionMetadataSchema = z.object({
  provider: z.string(),
  authorizationId: z.string(),
  generation: z.number().int(),
})
export type OauthConnectionMetadata = z.infer<typeof oauthConnectionMetadataSchema>
