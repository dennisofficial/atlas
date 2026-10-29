import { describe, expect, it, vi } from 'bun:test'
import { createAuthEmailHooks } from './auth-email-hooks'

describe('auth email hooks', () => {
  it('emails the reset link to the user', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ id: 'e1' })
    const hooks = createAuthEmailHooks({ sendEmail })

    await hooks.sendResetPassword({
      user: { email: 'delivered@resend.dev' },
      url: 'http://x/reset',
    })

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'delivered@resend.dev', subject: 'Reset your Atlas password' }),
    )
  })
})
