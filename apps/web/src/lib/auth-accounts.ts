import {
  type ISignInMethodIds,
  SESSION_NOT_FRESH,
  accountSchema,
  signInMethodsOf,
  unlinkRefusalOf,
} from '@dltech/atlas-client/settings'
import { z } from 'zod'

import { AuthApiError, authFetch, failWith, postJson, readBody } from './auth-api'

const GOOGLE_PROVIDER = 'google'

export type SignInMethodIds = ISignInMethodIds

export async function listSignInMethods(): Promise<SignInMethodIds> {
  const response = await authFetch('/api/auth/list-accounts')
  if (!response.ok) await failWith(response, 'Could not load your sign-in methods')
  const parsed = z.array(accountSchema).safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new AuthApiError('Could not load your sign-in methods')
  return signInMethodsOf(parsed.data)
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

export async function unlinkSignInMethod(accountId: string): Promise<void> {
  const response = await postJson({ path: '/api/auth/unlink-account', body: { accountId } })
  if (response.ok) return
  try {
    await failWith(response, 'Could not remove that sign-in method')
  } catch (cause) {
    if (cause instanceof AuthApiError && cause.code === SESSION_NOT_FRESH) {
      const refusal = unlinkRefusalOf({ message: cause.message, code: cause.code })
      throw new AuthApiError(refusal.message, { code: SESSION_NOT_FRESH })
    }
    throw cause
  }
}
