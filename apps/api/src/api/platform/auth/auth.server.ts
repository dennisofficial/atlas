import { db } from '../../../db'
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { bearer, deviceAuthorization, organization } from 'better-auth/plugins'

const secret = process.env.SECRET_KEY
if (!secret || secret.length < 32) {
  throw new Error('SECRET_KEY must be set to at least 32 characters — run through the env:inject script')
}

const trustedOrigins = (process.env.TRUSTED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0)

const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3001'

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3400',
  secret,
  database: prismaAdapter(db, { provider: 'postgresql' }),
  emailAndPassword: { enabled: true },
  trustedOrigins,
  plugins: [
    organization(),
    bearer(),
    deviceAuthorization({ verificationUri: `${webOrigin}/device` }),
  ],
})
