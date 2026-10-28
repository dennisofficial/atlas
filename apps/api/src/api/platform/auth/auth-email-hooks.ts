import type { EmailSender } from '../../../_lib/email/email-sender'
import { renderPasswordResetEmail } from '../../../_lib/email/auth-emails'

export function createAuthEmailHooks({ sendEmail }: { sendEmail: EmailSender }) {
  return {
    async sendResetPassword({
      user,
      url,
    }: {
      user: { email: string }
      url: string
    }): Promise<void> {
      await sendEmail({ to: user.email, ...renderPasswordResetEmail({ url }) })
    },
  }
}
