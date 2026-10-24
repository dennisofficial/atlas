import { z } from 'zod'

export enum EAuthProvider {
  Anthropic = 'anthropic',
  OpenAI = 'openai',
  OpenRouter = 'openrouter',
  Inference = 'inference',
}

export enum EAuthKind {
  Oauth = 'oauth',
  ApiKey = 'api-key',
}

export enum EAccountOrigin {
  Login = 'login',
  Imported = 'imported',
  Environment = 'environment',
}

export enum EAccountStatus {
  Active = 'active',
  Limited = 'limited',
  Expired = 'expired',
}

export const oauthTokensInputSchema = z.strictObject({
  accessToken: z.string().min(1),
  refreshToken: z.string(),
  expiresAt: z.string().min(1),
  scopes: z.array(z.string()).optional(),
  accountId: z.string().optional(),
})

export const oauthAuthorityInputSchema = z.strictObject({
  url: z.string().min(1),
  connectionId: z.string().min(1),
  generation: z.number().int().min(0).optional(),
  refreshAfter: z.string().optional(),
  authorizationId: z.string().optional(),
  previousAuthorizationId: z.string().optional(),
})

export const secretInputSchema = z.strictObject({
  kind: z.enum([EAuthKind.Oauth, EAuthKind.ApiKey]),
  tokens: oauthTokensInputSchema.optional(),
  authority: oauthAuthorityInputSchema.optional(),
  apiKey: z.string().optional(),
})

export const createAccountInputSchema = z.strictObject({
  provider: z.enum(EAuthProvider),
  label: z.string().min(1),
  origin: z.enum(EAccountOrigin),
  secret: secretInputSchema,
  email: z.string().optional(),
  subscription: z.string().optional(),
  importedFrom: z.string().optional(),
})

export const accountIdInputSchema = z.strictObject({ accountId: z.string().min(1) })

export const replaceSecretInputSchema = z.strictObject({
  accountId: z.string().min(1),
  secret: secretInputSchema,
})

export const setStatusInputSchema = z.strictObject({
  accountId: z.string().min(1),
  status: z.enum(EAccountStatus),
})

export const setActiveInputSchema = z.strictObject({
  provider: z.enum(EAuthProvider),
  accountId: z.string().min(1),
})

export const activeAccountInputSchema = z.strictObject({ provider: z.string() })

export const accountDtoSchema = z.object({
  id: z.string(),
  provider: z.string(),
  kind: z.string(),
  origin: z.string(),
  label: z.string(),
  status: z.string(),
  email: z.string().optional(),
  subscription: z.string().optional(),
  importedFrom: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const oauthTokensDtoSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.string(),
  scopes: z.array(z.string()).optional(),
  accountId: z.string().optional(),
})

export const oauthAuthorityDtoSchema = z.object({
  url: z.string(),
  connectionId: z.string(),
  generation: z.number().optional(),
  refreshAfter: z.string().optional(),
  authorizationId: z.string().optional(),
  previousAuthorizationId: z.string().optional(),
})

export const accountSecretDtoSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal(EAuthKind.Oauth),
    tokens: oauthTokensDtoSchema,
    authority: oauthAuthorityDtoSchema.optional(),
  }),
  z.object({ kind: z.literal(EAuthKind.ApiKey), apiKey: z.string() }),
])

export const storedAccountDtoSchema = accountDtoSchema.extend({ secret: accountSecretDtoSchema })

export const activeAccountDtoSchema = z.object({ accountId: z.string().nullable() })

export type OauthTokensInput = z.infer<typeof oauthTokensInputSchema>
export type OauthAuthorityInput = z.infer<typeof oauthAuthorityInputSchema>
export type SecretInput = z.infer<typeof secretInputSchema>
export type CreateAccountInput = z.infer<typeof createAccountInputSchema>
export type AccountIdInput = z.infer<typeof accountIdInputSchema>
export type ReplaceSecretInput = z.infer<typeof replaceSecretInputSchema>
export type SetStatusInput = z.infer<typeof setStatusInputSchema>
export type SetActiveInput = z.infer<typeof setActiveInputSchema>
export type ActiveAccountInput = z.infer<typeof activeAccountInputSchema>
export type OauthTokensDto = z.infer<typeof oauthTokensDtoSchema>
export type OauthAuthorityDto = z.infer<typeof oauthAuthorityDtoSchema>
export type AccountSecretDto = z.infer<typeof accountSecretDtoSchema>
export type AccountDto = z.infer<typeof accountDtoSchema>
export type StoredAccountDto = z.infer<typeof storedAccountDtoSchema>
export type ActiveAccountDto = z.infer<typeof activeAccountDtoSchema>
