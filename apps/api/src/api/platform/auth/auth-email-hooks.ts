import type { EmailSender } from '../../../_lib/email/email-sender'
import { renderInvitationEmail, renderPasswordResetEmail } from '../../../_lib/email/auth-emails'

export function invitationUrl({ webOrigin, id }: { webOrigin: string; id: string }): string {
  return `${webOrigin}/invite/${id}`
}

interface IInvitationEmailData {
  id: string
  email: string
  organization: { name: string }
  inviter: { user: { name: string; email: string } }
}

export function createAuthEmailHooks({ sendEmail, webOrigin }: { sendEmail: EmailSender; webOrigin: string }) {
  return {
    async sendResetPassword({ user, url }: { user: { email: string }; url: string }): Promise<void> {
      await sendEmail({ to: user.email, ...renderPasswordResetEmail({ url }) })
    },
    async sendInvitationEmail({ id, email, organization, inviter }: IInvitationEmailData): Promise<void> {
      await sendEmail({
        to: email,
        ...renderInvitationEmail({
          url: invitationUrl({ webOrigin, id }),
          workspaceName: organization.name,
          inviterName: inviter.user.name,
          inviterEmail: inviter.user.email,
        }),
      })
    },
  }
}
