export const webCallbackPath = '/auth/callback'

export interface IAuthorizeRequest {
  authorizeUrl: string
  verifier: string
  state: string
  redirectUri: string
}

export const buildAuthorizeUrl = ({
  webOrigin,
  redirectUri,
  state,
  codeChallenge,
}: {
  webOrigin: string
  redirectUri: string
  state: string
  codeChallenge: string
}): string => {
  const query = new URLSearchParams({
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })
  return `${webOrigin.replace(/\/+$/, '')}/desktop/authorize?${query.toString()}`
}

export const webRedirectUri = ({ origin }: { origin: string }): string =>
  `${origin.replace(/\/+$/, '')}${webCallbackPath}`

export enum ECallbackResult {
  Success = 'success',
  StateMismatch = 'state-mismatch',
  MissingCode = 'missing-code',
}

export type TCallbackOutcome =
  | { kind: ECallbackResult.Success; code: string }
  | { kind: ECallbackResult.StateMismatch }
  | { kind: ECallbackResult.MissingCode }

export const parseAuthCallback = ({
  url,
  expectedState,
}: {
  url: string
  expectedState: string
}): TCallbackOutcome => {
  const params = new URL(url).searchParams
  const state = params.get('state')
  if (state === null || state !== expectedState) return { kind: ECallbackResult.StateMismatch }
  const code = params.get('code')
  if (code === null || code.length === 0) return { kind: ECallbackResult.MissingCode }
  return { kind: ECallbackResult.Success, code }
}
