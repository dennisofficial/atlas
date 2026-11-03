import * as WebBrowser from 'expo-web-browser'

import {
  buildAuthorizeUrl,
  ECallbackResult,
  parseAuthCallback,
  webRedirectUri,
} from './pending-auth'
import { createPkcePair } from './pkce'
import { pendingAuthStorage } from './token-store.web'

export enum EHandoffResult {
  Redirect = 'redirect',
  Cancelled = 'cancelled',
  StateMismatch = 'state-mismatch',
  MissingCode = 'missing-code',
}

export type THandoffOutcome =
  | { kind: EHandoffResult.Redirect; code: string; verifier: string; redirectUri: string }
  | { kind: EHandoffResult.Cancelled }
  | { kind: EHandoffResult.StateMismatch }
  | { kind: EHandoffResult.MissingCode }

interface IPendingAuth {
  verifier: string
  state: string
  redirectUri: string
}

const fullPageRedirect = ({ authorizeUrl }: { authorizeUrl: string }): THandoffOutcome => {
  window.location.assign(authorizeUrl)
  return { kind: EHandoffResult.Cancelled }
}

export const runHandoffSignIn = async ({
  webOrigin,
}: {
  webOrigin: string
}): Promise<THandoffOutcome> => {
  const pair = await createPkcePair()
  const redirectUri = webRedirectUri({ origin: window.location.origin })
  const authorizeUrl = buildAuthorizeUrl({
    webOrigin,
    redirectUri,
    state: pair.state,
    codeChallenge: pair.challenge,
  })
  const storage = pendingAuthStorage()
  const pending: IPendingAuth = { verifier: pair.verifier, state: pair.state, redirectUri }
  try {
    const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, redirectUri)
    if (result.type !== 'success') return { kind: EHandoffResult.Cancelled }
    const outcome = parseAuthCallback({ url: result.url, expectedState: pair.state })
    if (outcome.kind === ECallbackResult.StateMismatch) {
      return { kind: EHandoffResult.StateMismatch }
    }
    if (outcome.kind === ECallbackResult.MissingCode) return { kind: EHandoffResult.MissingCode }
    return {
      kind: EHandoffResult.Redirect,
      code: outcome.code,
      verifier: pair.verifier,
      redirectUri,
    }
  } catch {
    storage.save(JSON.stringify(pending))
    return fullPageRedirect({ authorizeUrl })
  }
}
