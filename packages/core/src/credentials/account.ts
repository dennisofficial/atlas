import { z } from 'zod'

export enum EAuthKind {
  Oauth = 'oauth',
  ApiKey = 'api-key',
}

export enum EAuthProvider {
  Anthropic = 'anthropic',
  OpenAI = 'openai',
  OpenRouter = 'openrouter',
  Inference = 'inference',
}

export enum EAccountStatus {
  Active = 'active',
  Limited = 'limited',
  Expired = 'expired',
}

export enum EAccountOrigin {
  Login = 'login',
  Imported = 'imported',
  Environment = 'environment',
}

export const accountIdSchema = z.string().min(1).brand<'AccountId'>()

export type AccountId = z.infer<typeof accountIdSchema>

export const toAccountId = (value: string): AccountId => accountIdSchema.parse(value)

export const oauthTokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string(),
  expiresAt: z.string().min(1),
  scopes: z.array(z.string()).optional(),
  accountId: z.string().optional(),
})

export type OauthTokens = z.infer<typeof oauthTokensSchema>

export const oauthAuthoritySchema = z.object({
  url: z.string().min(1),
  connectionId: z.string().min(1),
  generation: z.number().int().nonnegative().optional(),
  refreshAfter: z.string().optional(),
  authorizationId: z.string().min(1).optional(),
  previousAuthorizationId: z.string().min(1).optional(),
})

export type OauthAuthority = z.infer<typeof oauthAuthoritySchema>

export const accountSecretSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal(EAuthKind.Oauth),
    tokens: oauthTokensSchema,
    authority: oauthAuthoritySchema.optional(),
  }),
  z.object({ kind: z.literal(EAuthKind.ApiKey), apiKey: z.string().min(1) }),
])

export type AccountSecret = z.infer<typeof accountSecretSchema>

export const authorityOf = (secret: AccountSecret): OauthAuthority | undefined =>
  secret.kind === EAuthKind.Oauth ? secret.authority : undefined

export const accountSchema = z.object({
  id: accountIdSchema,
  provider: z.enum(EAuthProvider),
  kind: z.enum(EAuthKind),
  origin: z.enum(EAccountOrigin),
  label: z.string().min(1),
  status: z.enum(EAccountStatus),
  email: z.string().optional(),
  subscription: z.string().optional(),
  importedFrom: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Account = z.infer<typeof accountSchema>

export const storedAccountSchema = accountSchema.extend({ secret: accountSecretSchema })

export type StoredAccount = z.infer<typeof storedAccountSchema>

export const accountOf = (stored: StoredAccount): Account => {
  const { secret: _secret, ...account } = stored
  return account
}
