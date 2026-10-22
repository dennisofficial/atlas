import { describe, expect, it } from 'bun:test'

import { signInErrorMessage } from '../sign-in-error'

const errorsOf = (url: string): string[] => new URL(url).searchParams.getAll('error')

describe('signInErrorMessage', () => {
  it('tells an existing password user how to reach their account when Google is not linked', () => {
    const errors = errorsOf(
      'https://byatlas.io/sign-in?error=google&next=%2Fthreads%2Fnew&error=account_not_linked',
    )

    expect(signInErrorMessage(errors)).toBe(
      'This email already has an Atlas account. Sign in with your password, then link Google in Settings.',
    )
  })

  it('keeps the generic Google message for any other redirect error', () => {
    expect(signInErrorMessage(errorsOf('https://byatlas.io/sign-in?error=google'))).toBe(
      "Google sign-in didn't complete. Try again, or use your email.",
    )
    expect(
      signInErrorMessage(errorsOf('https://byatlas.io/sign-in?error=google&error=access_denied')),
    ).toBe("Google sign-in didn't complete. Try again, or use your email.")
  })

  it('answers null when the url carries no error', () => {
    expect(signInErrorMessage(errorsOf('https://byatlas.io/sign-in?next=%2F'))).toBeNull()
  })
})
