import type { OauthTokens } from '@dltech/atlas-core'
import { z } from 'zod'

import { CredentialError, ECredentialFailure } from './credential-error'
import { decodeJwtClaims } from './oauth/jwt-claims'

const codexAuthBlobSchema = z.object({
  tokens: z
    .object({
      id_token: z.string().optional(),
      access_token: z.string().min(1),
      refresh_token: z.string(),
      account_id: z.string().optional(),
    })
    .nullish(),
})

export type CodexCredential = {
  tokens: OauthTokens
  email?: string
  plan?: string
}

const unreadableCredential = (detail: string): CredentialError =>
  new CredentialError({
    failure: ECredentialFailure.Unreadable,
    message: `The Codex credential could not be read: ${detail}.`,
  })

const parseJsonWithoutQuotingIt = (payload: string): unknown => {
  try {
    return JSON.parse(payload)
  } catch {
    throw unreadableCredential('the stored value is not valid JSON')
  }
}

const parseJsonQuietly = (payload: string): unknown => {
  try {
    return JSON.parse(payload)
  } catch {
    return {}
  }
}

const objectOr = (payload: unknown): Record<string, unknown> =>
  typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}

const stringOr = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

/** The file carries no expiry field; the access token's own exp claim is the only honest one. */
const expiryOf = (accessToken: string): string => {
  const exp = decodeJwtClaims(accessToken)?.exp
  if (typeof exp !== 'number' || !Number.isFinite(exp))
    throw unreadableCredential('the access token carries no expiry claim')

  return new Date(exp * 1000).toISOString()
}

export const parseCodexAuthBlob = (payload: string): CodexCredential | undefined => {
  const parsed = codexAuthBlobSchema.safeParse(parseJsonWithoutQuotingIt(payload))

  if (!parsed.success) {
    const fields = parsed.error.issues
      .map((issue) => (issue.path.length === 0 ? 'the credential root' : issue.path.join('.')))
      .join(', ')

    throw unreadableCredential(`unexpected shape at ${fields}`)
  }

  const tokens = parsed.data.tokens
  if (tokens === null || tokens === undefined) return undefined

  const claims = tokens.id_token === undefined ? undefined : decodeJwtClaims(tokens.id_token)
  const email = stringOr(claims?.email) ?? stringOr(claims?.['https://api.openai.com/profile']?.email)
  const plan = stringOr(claims?.['https://api.openai.com/auth']?.chatgpt_plan_type)
  const accountId =
    tokens.account_id ??
    stringOr(claims?.['https://api.openai.com/auth']?.chatgpt_account_id)

  return {
    tokens: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: expiryOf(tokens.access_token),
      ...(accountId === undefined ? {} : { accountId }),
    },
    ...(email === undefined ? {} : { email }),
    ...(plan === undefined ? {} : { plan }),
  }
}

/**
 * Rendered in the shape Codex reads, over the top of whatever else the file carried: `auth_mode`
 * and a login-only `id_token` sit beside the rotating pair and survive a write-back.
 */
export const codexAuthBlob = (args: {
  tokens: OauthTokens
  existing?: string | undefined
}): string => {
  const existing = args.existing === undefined ? {} : objectOr(parseJsonQuietly(args.existing))
  const previous = objectOr(existing.tokens)

  return JSON.stringify({
    ...existing,
    tokens: {
      ...previous,
      access_token: args.tokens.accessToken,
      refresh_token: args.tokens.refreshToken,
      ...(args.tokens.accountId === undefined ? {} : { account_id: args.tokens.accountId }),
    },
    last_refresh: new Date().toISOString(),
  })
}
