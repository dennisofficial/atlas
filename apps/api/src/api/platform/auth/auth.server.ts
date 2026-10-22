import { db } from '../../../db'
import { createEmailSender } from '../../../_lib/email/email-sender'
import { createAuthEmailHooks } from './auth-email-hooks'
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { bearer, deviceAuthorization, organization } from 'better-auth/plugins'

const secret = process.env.SECRET_KEY
if (!secret || secret.length < 32) {
  throw new Error('SECRET_KEY must be set to at least 32 characters — run through the env:inject script')
}

const googleClientId = process.env.GOOGLE_CLIENT_ID
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET
if (!googleClientId || !googleClientSecret) {
  throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set — run through the env:inject script')
}

const resendApiKey = process.env.RESEND_API_KEY
if (!resendApiKey) {
  throw new Error('RESEND_API_KEY must be set — run through the env:inject script')
}

const trustedOrigins = (process.env.TRUSTED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0)

const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3001'

const emailHooks = createAuthEmailHooks({
  sendEmail: createEmailSender({
    apiKey: resendApiKey,
    from: process.env.EMAIL_FROM ?? 'Atlas <noreply@mail.byatlas.io>',
  }),
  webOrigin,
})

// better-auth defaults the callback to BETTER_AUTH_URL (api.byatlas.io), but browsers reach auth only
// through the web app's /api/* rewrite, so the OAuth state and session cookies live on WEB_ORIGIN.
const googleRedirectUri = `${webOrigin}/api/auth/callback/google`

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3400',
  secret,
  database: prismaAdapter(db, { provider: 'postgresql' }),
  emailAndPassword: {
    enabled: true,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: emailHooks.sendResetPassword,
  },
  socialProviders: {
    google: {
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      redirectURI: googleRedirectUri,
    },
  },
  trustedOrigins,
  plugins: [
    organization({ sendInvitationEmail: emailHooks.sendInvitationEmail }),
    bearer(),
    deviceAuthorization({ verificationUri: `${webOrigin}/device` }),
  ],
})
