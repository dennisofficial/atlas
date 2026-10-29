import { describe, expect, it } from 'bun:test'
import { renderPasswordResetEmail } from './auth-emails'

const URL = 'https://byatlas.io/api/auth/reset-password/tok?callbackURL=%2Freset-password&x=1&y=2'

describe('renderPasswordResetEmail', () => {
  it('carries the link in the button, the fallback and the text body', () => {
    const email = renderPasswordResetEmail({ url: URL })

    expect(email.subject).toBe('Reset your Atlas password')
    expect(email.html).toContain(
      'href="https://byatlas.io/api/auth/reset-password/tok?callbackURL=%2Freset-password&amp;x=1&amp;y=2"',
    )
    expect(email.text).toContain(URL)
    expect(email.text).toContain("If you didn't ask for this, you can ignore this email.")
  })
})
