import { EReturnResult, type ReturnOutcome } from '@dltech/atlas-core'
import { GOOGLE_LINKED, linkReturnOf } from './link-return'
import type { ISignInMethodIds } from './sign-in-methods'

export type GoogleReauthBegin = (input: {
  redirectUri: string
  state: string
  codeChallenge: string
  codeChallengeMethod: 'S256'
}) => Promise<{ url: string }>

export const googleReauthCallbackPath = (args: {
  pathname: string
  params: URLSearchParams
}): string => {
  const params = new URLSearchParams(args.params)
  params.delete('google_start')
  return `${args.pathname}?${params.toString()}`
}

export const confirmationMethodsOf = (methods: ISignInMethodIds | undefined) => ({
  password: methods?.password != null,
  google: methods?.google != null,
})

export const googleLinkMessageOf = (
  outcome: ReturnOutcome,
): { success: boolean; message: string } => {
  if (outcome.result === EReturnResult.Connected) return { success: true, message: GOOGLE_LINKED }
  const params = new URLSearchParams({ error: outcome.reason ?? 'link_failed' })
  return { success: false, message: linkReturnOf(params)?.message ?? 'Google linking failed' }
}
