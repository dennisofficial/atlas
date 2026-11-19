import { sharedPool } from '@dltech/atlas-db'
import { serverAnalytics } from '../../../agent'
import { createEmailSender } from '../../../_lib/email/email-sender'
import { captureSignedIn, captureSignedUp } from './auth-analytics'
import { createAuthEmailHooks } from './auth-email-hooks'
import { deletePushDevicesOfSession } from './auth-session-hooks'
import { sessionStorageFromEnv } from './auth-session-storage'
import { missingTrustedOrigins } from './trusted-origins'
import { betterAuth } from 'better-auth'
import { bearer, deviceAuthorization } from 'better-auth/plugins'

const secret = process.env.SECRET_KEY
if (!secret || secret.length < 32) {
  throw new Error(
    'SECRET_KEY must be set to at least 32 characters — run through the env:inject script',
  )
}

const googleClientId = process.env.GOOGLE_CLIENT_ID
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET
if (!googleClientId || !googleClientSecret) {
  throw new Error(
    'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set — run through the env:inject script',
  )
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

const missingOrigins = missingTrustedOrigins({ trustedOrigins, webOrigin })
if (missingOrigins.length > 0) {
  console.error(
    `[auth] BROWSER SIGN-IN WILL FAIL: WEB_ORIGIN "${webOrigin}" is not in TRUSTED_ORIGINS "${trustedOrigins.join(',') || '(unset)'}" — every browser sign-in answers "Invalid origin". Add "${webOrigin}" to TRUSTED_ORIGINS.`,
  )
}

const emailHooks = createAuthEmailHooks({
  sendEmail: createEmailSender({
    apiKey: resendApiKey,
    from: process.env.EMAIL_FROM ?? 'Atlas <noreply@mail.byatlas.io>',
  }),
})

// better-auth defaults the callback to BETTER_AUTH_URL (api.byatlas.io), but Google redirects to the
// web app's /api/auth/callback rewrite, so the OAuth state cookie is minted on WEB_ORIGIN.
const googleRedirectUri = `${webOrigin}/api/auth/callback/google`

// The native app signs in with an ID token only, so no client secret (which would build the web
// authorization URL) is configured; audience verification goes through appBundleIdentifier.
const appleBundleIdentifier = process.env.APPLE_APP_BUNDLE_IDENTIFIER

// Unset outside production: a host-only cookie is what the web app and the local API share on localhost.
const cookieDomain = process.env.AUTH_COOKIE_DOMAIN

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3400',
  secret,
  database: sharedPool(),
  advanced: {
    database: { validateSchema: false },
    ...(cookieDomain === undefined || cookieDomain.length === 0
      ? {}
      : { crossSubDomainCookies: { enabled: true, domain: cookieDomain } }),
  },
  user: { modelName: 'User' },
  secondaryStorage: sessionStorageFromEnv(process.env.REDIS_URL),
  session: {
    modelName: 'AuthSession',
    cookieCache: { enabled: true, maxAge: 300 },
    storeSessionInDatabase: true,
  },
  account: {
    modelName: 'Account',
    accountLinking: { enabled: true, trustedProviders: ['google', 'apple'] },
  },
  verification: { modelName: 'Verification', storeInDatabase: true },
  rateLimit: { storage: 'memory' },
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
    ...(appleBundleIdentifier === undefined
      ? {}
      : { apple: { clientId: appleBundleIdentifier, appBundleIdentifier: appleBundleIdentifier } }),
  },
  trustedOrigins,
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({ data: { ...user, active: false } }),
        after: async (user, context) => captureSignedUp(serverAnalytics().analytics, user, context),
      },
    },
    session: {
      create: {
        after: async (session, context) =>
          captureSignedIn(serverAnalytics().analytics, session, context),
      },
      delete: { after: deletePushDevicesOfSession },
    },
  },
  plugins: [
    bearer(),
    deviceAuthorization({
      verificationUri: `${webOrigin}/device`,
      schema: { deviceCode: { modelName: 'DeviceCode' } },
    }),
  ],
})
