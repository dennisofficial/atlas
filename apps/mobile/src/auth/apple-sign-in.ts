export enum EAppleSignInResult {
  SignedIn = 'signed-in',
  Cancelled = 'cancelled',
  Failed = 'failed',
}

export type TAppleSignInOutcome =
  | { kind: EAppleSignInResult.SignedIn; token: string }
  | { kind: EAppleSignInResult.Cancelled }
  | { kind: EAppleSignInResult.Failed; error: string }

export const isAppleSignInAvailable = async (): Promise<boolean> => false

export const signInWithApple = async ({
  apiOrigin,
}: {
  apiOrigin: string
}): Promise<TAppleSignInOutcome> => ({
  kind: EAppleSignInResult.Failed,
  error: 'Sign in with Apple is only available on iOS',
})
