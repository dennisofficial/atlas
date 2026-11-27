import { EReturnResult, LOOPBACK_HOST, parsedUrlOf } from '@dltech/atlas-core'

import type { LoopbackCopy } from '../browser-return/loopback-page'
import type { LoopbackAccepted } from '../browser-return/loopback-server'

export const DESKTOP_CALLBACK_PATH = '/desktop/auth/callback'

export type LoginReturn = { code: string }

export const LOGIN_COPY: LoopbackCopy = {
  connected: 'Signed in to Atlas.',
  failed: (reason) => `Sign-in failed: ${reason ?? 'the browser did not come back with a code'}`,
}

export const loginRedirectUriOf = (port: number): string =>
  `http://${LOOPBACK_HOST}:${port}${DESKTOP_CALLBACK_PATH}`

export const authorizeUrlOf = (args: {
  webOrigin: string
  redirectUri: string
  challenge: string
  state: string
}): string => {
  const query = new URLSearchParams({
    redirect_uri: args.redirectUri,
    state: args.state,
    code_challenge: args.challenge,
    code_challenge_method: 'S256',
  })
  return `${args.webOrigin.replace(/\/+$/, '')}/desktop/authorize?${query.toString()}`
}

export const loginReturnOf = (args: {
  url: string
  state: string
}): LoopbackAccepted<LoginReturn> | undefined => {
  const parsed = parsedUrlOf(args.url)
  if (parsed === undefined) return undefined
  if (parsed.searchParams.get('state') !== args.state) return undefined
  const code = parsed.searchParams.get('code')
  if (code === null || code === '') return undefined
  return { page: { result: EReturnResult.Connected }, value: { code } }
}
