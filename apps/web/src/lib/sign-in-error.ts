export const GOOGLE_SIGN_IN_FAILED = "Google sign-in didn't complete. Try again, or use your email."

export const ACCOUNT_NOT_LINKED =
  'This email already has an Atlas account. Sign in with your password, then link Google in Settings.'

const BETTER_AUTH_ACCOUNT_NOT_LINKED = 'account_not_linked'

export function signInErrorMessage(errors: string[]): string | null {
  if (errors.length === 0) return null
  if (errors.includes(BETTER_AUTH_ACCOUNT_NOT_LINKED)) return ACCOUNT_NOT_LINKED
  return GOOGLE_SIGN_IN_FAILED
}
