import * as AppleAuthentication from 'expo-apple-authentication'
import * as Crypto from 'expo-crypto'

import { base64UrlEncode, sha256Hex } from './pkce'

export enum EAppleSignInResult {
  SignedIn = 'signed-in',
  Cancelled = 'cancelled',
  Failed = 'failed',
}

export type TAppleSignInOutcome =
  | { kind: EAppleSignInResult.SignedIn; token: string }
  | { kind: EAppleSignInResult.Cancelled }
  | { kind: EAppleSignInResult.Failed; error: string }

export const isAppleSignInAvailable = async (): Promise<boolean> => {
  try {
    return await AppleAuthentication.isAvailableAsync()
  } catch {
    return false
  }
}

const extractBearerToken = ({ response }: { response: Response }): string | undefined => {
  const header = response.headers.get('set-auth-token')
  return header === null || header.length === 0 ? undefined : header
}

export const signInWithApple = async ({
  apiOrigin,
  fetchFn = fetch,
}: {
  apiOrigin: string
  fetchFn?: typeof fetch
}): Promise<TAppleSignInOutcome> => {
  const rawNonce = base64UrlEncode({ bytes: Crypto.getRandomBytes(32) })
  const hashedNonce = await sha256Hex({ value: rawNonce })
  let identityToken: string | null
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    })
    identityToken = credential.identityToken
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ERR_REQUEST_CANCELED'
    ) {
      return { kind: EAppleSignInResult.Cancelled }
    }
    return { kind: EAppleSignInResult.Failed, error: 'Apple sign-in failed' }
  }
  if (identityToken === null) {
    return { kind: EAppleSignInResult.Failed, error: 'Apple did not return an identity token' }
  }
  try {
    const response = await fetchFn(`${apiOrigin}/api/auth/sign-in/social`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'apple',
        idToken: { token: identityToken, nonce: rawNonce },
      }),
    })
    if (!response.ok) {
      return { kind: EAppleSignInResult.Failed, error: 'The server rejected Apple sign-in' }
    }
    const token = extractBearerToken({ response })
    if (token === undefined) {
      return { kind: EAppleSignInResult.Failed, error: 'The server did not return a session token' }
    }
    return { kind: EAppleSignInResult.SignedIn, token }
  } catch {
    return { kind: EAppleSignInResult.Failed, error: 'Could not reach the Atlas API' }
  }
}
