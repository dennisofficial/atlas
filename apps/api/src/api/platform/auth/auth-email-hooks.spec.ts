import { describe, expect, it, vi } from 'bun:test'
import { createAuthEmailHooks, invitationUrl } from './auth-email-hooks'

describe('auth email hooks', () => {
  it('builds the invitation link on the web origin', () => {
    expect(invitationUrl({ webOrigin: 'http://localhost:3001', id: 'inv_1' })).toBe('http://localhost:3001/invite/inv_1')
  })

  it('emails the reset link to the user', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ id: 'e1' })
    const hooks = createAuthEmailHooks({ sendEmail, webOrigin: 'http://localhost:3001' })

    await hooks.sendResetPassword({ user: { email: 'delivered@resend.dev' }, url: 'http://x/reset' })

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'delivered@resend.dev', subject: 'Reset your Atlas password' }),
    )
  })

  it('emails the invitation with the inviter and workspace', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ id: 'e2' })
    const hooks = createAuthEmailHooks({ sendEmail, webOrigin: 'http://localhost:3001' })

    await hooks.sendInvitationEmail({
      id: 'inv_9',
      email: 'delivered@resend.dev',
      organization: { name: 'Acme' },
      inviter: { user: { name: 'Ada', email: 'ada@acme.dev' } },
    })

    const message = sendEmail.mock.calls[0]?.[0]
    expect(message.to).toBe('delivered@resend.dev')
    expect(message.subject).toBe('Join Acme on Atlas')
    expect(message.text).toContain('http://localhost:3001/invite/inv_9')
  })
})
