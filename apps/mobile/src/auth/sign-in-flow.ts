import type { GoogleReauthBegin } from '@dltech/atlas-client/settings'
import * as WebBrowser from 'expo-web-browser'

import { nativeRedirectUri } from '../config'
import { buildAuthorizeUrl, ECallbackResult, parseAuthCallback } from './pending-auth'
import { createPkcePair } from './pkce'

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

export const runHandoffSignIn = async ({
  webOrigin,
  beginGoogleReauth,
}: {
  webOrigin: string
  beginGoogleReauth?: GoogleReauthBegin | undefined
}): Promise<THandoffOutcome> => {
  const pair = await createPkcePair()
  const authorizeUrl =
    beginGoogleReauth === undefined
      ? buildAuthorizeUrl({
          webOrigin,
          redirectUri: nativeRedirectUri,
          state: pair.state,
          codeChallenge: pair.challenge,
        })
      : (
          await beginGoogleReauth({
            redirectUri: nativeRedirectUri,
            state: pair.state,
            codeChallenge: pair.challenge,
            codeChallengeMethod: 'S256',
          })
        ).url
  const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, nativeRedirectUri)
  if (result.type !== 'success') return { kind: EHandoffResult.Cancelled }
  const outcome = parseAuthCallback({ url: result.url, expectedState: pair.state })
  if (outcome.kind === ECallbackResult.StateMismatch) return { kind: EHandoffResult.StateMismatch }
  if (outcome.kind === ECallbackResult.MissingCode) return { kind: EHandoffResult.MissingCode }
  return {
    kind: EHandoffResult.Redirect,
    code: outcome.code,
    verifier: pair.verifier,
    redirectUri: nativeRedirectUri,
  }
}
