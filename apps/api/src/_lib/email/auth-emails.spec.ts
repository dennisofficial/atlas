import { describe, expect, it } from 'bun:test'
import { renderInvitationEmail, renderPasswordResetEmail } from './auth-emails'

const URL = 'https://byatlas.io/api/auth/reset-password/tok?callbackURL=%2Freset-password&x=1&y=2'

describe('renderPasswordResetEmail', () => {
  it('carries the link in the button, the fallback and the text body', () => {
    const email = renderPasswordResetEmail({ url: URL })

    expect(email.subject).toBe('Reset your Atlas password')
    expect(email.html).toContain('href="https://byatlas.io/api/auth/reset-password/tok?callbackURL=%2Freset-password&amp;x=1&amp;y=2"')
    expect(email.text).toContain(URL)
    expect(email.text).toContain("If you didn't ask for this, you can ignore this email.")
  })
})

describe('renderInvitationEmail', () => {
  it('names the workspace and the inviter', () => {
    const email = renderInvitationEmail({
      url: 'http://localhost:3001/invite/inv_1',
      workspaceName: 'Acme',
      inviterName: 'Ada',
      inviterEmail: 'ada@acme.dev',
    })

    expect(email.subject).toBe('Join Acme on Atlas')
    expect(email.text).toContain('Ada (ada@acme.dev) invited you to Acme.')
    expect(email.text).toContain('http://localhost:3001/invite/inv_1')
  })

  it('escapes HTML in workspace and inviter names', () => {
    const email = renderInvitationEmail({
      url: 'http://localhost:3001/invite/inv_1',
      workspaceName: '<script>alert(1)</script>',
      inviterName: '"><img src=x>',
      inviterEmail: 'a@b.c',
    })

    expect(email.html).not.toContain('<script>')
    expect(email.html).not.toContain('<img src=x>')
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('falls back to the inviter email when the name is blank', () => {
    const email = renderInvitationEmail({ url: 'u', workspaceName: 'Acme', inviterName: ' ', inviterEmail: 'ada@acme.dev' })

    expect(email.text).toContain('ada@acme.dev invited you to Acme.')
  })
})
