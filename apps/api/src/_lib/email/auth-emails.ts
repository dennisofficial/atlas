import { escapeHtml } from './email-html'

export interface IRenderedEmail {
  subject: string
  html: string
  text: string
}

interface IActionEmail {
  subject: string
  heading: string
  intro: string
  action: string
  url: string
}

const BRAND = 'Atlas'
const ACTION_COLOR = '#d97757'
const FOOTNOTE = "If you didn't ask for this, you can ignore this email."
const FALLBACK = 'If the button does not work, paste this link into your browser:'
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"

function renderActionEmail({ subject, heading, intro, action, url }: IActionEmail): IRenderedEmail {
  const href = escapeHtml(url)
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#fafaf9;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fafaf9;">
      <tr>
        <td align="center" style="padding:48px 24px 56px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;font-family:${SANS};">
            <tr>
              <td style="font-size:18px;line-height:24px;font-weight:600;color:#1c1917;">${BRAND}</td>
            </tr>
            <tr>
              <td style="padding-top:40px;">
                <h1 style="margin:0;font-size:24px;line-height:32px;font-weight:600;color:#1c1917;">${escapeHtml(heading)}</h1>
                <p style="margin:8px 0 0;font-size:16px;line-height:24px;color:#57534e;">${escapeHtml(intro)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding-top:24px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td bgcolor="${ACTION_COLOR}" style="border-radius:8px;background:${ACTION_COLOR};">
                      <a href="${href}" target="_blank" style="display:inline-block;padding:10px 20px;font-size:14px;line-height:20px;font-weight:500;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(action)}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding-top:40px;">
                <p style="margin:0;font-size:14px;line-height:20px;color:#57534e;">${FALLBACK}</p>
                <p style="margin:4px 0 0;font-size:13px;line-height:20px;word-break:break-all;"><a href="${href}" target="_blank" style="color:#57534e;text-decoration:none;">${href}</a></p>
                <p style="margin:24px 0 0;font-size:14px;line-height:20px;color:#57534e;">${FOOTNOTE}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  const text = [subject, '', intro, '', url, '', FOOTNOTE].join('\n')
  return { subject, html, text }
}

export function renderPasswordResetEmail({ url }: { url: string }): IRenderedEmail {
  return renderActionEmail({
    subject: 'Reset your Atlas password',
    heading: 'Reset your Atlas password',
    intro: 'Choose a new password. This link expires in one hour.',
    action: 'Choose a new password',
    url,
  })
}

export function renderInvitationEmail({
  url,
  workspaceName,
  inviterName,
  inviterEmail,
}: {
  url: string
  workspaceName: string
  inviterName: string
  inviterEmail: string
}): IRenderedEmail {
  const inviter = inviterName.trim() === '' ? inviterEmail : `${inviterName} (${inviterEmail})`
  return renderActionEmail({
    subject: `Join ${workspaceName} on Atlas`,
    heading: `Join ${workspaceName} on Atlas`,
    intro: `${inviter} invited you to ${workspaceName}.`,
    action: 'Accept invitation',
    url,
  })
}
