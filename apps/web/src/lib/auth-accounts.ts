import { z } from 'zod'

import { AuthApiError, failWith, postJson, readBody, UNREACHABLE } from './auth-api'

const CREDENTIAL_PROVIDER = 'credential'
const GOOGLE_PROVIDER = 'google'

const accountsSchema = z.array(z.object({ id: z.string(), providerId: z.string() }))

export type SignInMethodIds = {
  google: string | null
  password: string | null
}

export async function listSignInMethods(): Promise<SignInMethodIds> {
  let response: Response
  try {
    response = await fetch('/api/auth/list-accounts', { credentials: 'same-origin' })
  } catch {
    throw new AuthApiError(UNREACHABLE)
  }
  if (!response.ok) await failWith(response, 'Could not load your sign-in methods')
  const parsed = accountsSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new AuthApiError('Could not load your sign-in methods')
  const idOf = (providerId: string): string | null =>
    parsed.data.find((account) => account.providerId === providerId)?.id ?? null
  return { google: idOf(GOOGLE_PROVIDER), password: idOf(CREDENTIAL_PROVIDER) }
}

export async function linkGoogleUrl(args: { origin: string }): Promise<string> {
  const response = await postJson({
    path: '/api/auth/link-social',
    body: {
      provider: GOOGLE_PROVIDER,
      callbackURL: `${args.origin}/settings/account?linked=google`,
      errorCallbackURL: `${args.origin}/settings/account`,
    },
  })
  if (!response.ok) await failWith(response, 'Google linking is unavailable')
  const body = await readBody(response)
  if (typeof body.url !== 'string') throw new AuthApiError('Google linking is unavailable')
  return body.url
}

const SESSION_NOT_FRESH = 'SESSION_NOT_FRESH'
const SIGN_IN_AGAIN = 'Sign out and back in, then remove this sign-in method.'

export async function unlinkSignInMethod(accountId: string): Promise<void> {
  const response = await postJson({ path: '/api/auth/unlink-account', body: { accountId } })
  if (response.ok) return
  try {
    await failWith(response, 'Could not remove that sign-in method')
  } catch (cause) {
    if (cause instanceof AuthApiError && cause.code === SESSION_NOT_FRESH) {
      throw new AuthApiError(SIGN_IN_AGAIN, { code: SESSION_NOT_FRESH })
    }
    throw cause
  }
}
