import { randomBytes } from 'node:crypto'
import { BadRequestException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import type { BeginGoogleReauthInput } from '@dltech/atlas-wire'
import { z } from 'zod'
import { auth } from '../auth/auth.server'

const pendingSchema = z.object({
  userId: z.string(),
  startedAt: z.number(),
  redirectUri: z.string(),
  codeChallenge: z.string(),
})

export const beginGoogleReauth = async (args: {
  userId: string
  input: BeginGoogleReauthInput
  webOrigin: string
}): Promise<string> => {
  const google = await db.orm.public.Account.first({ userId: args.userId, providerId: 'google' })
  if (google === null) throw new BadRequestException('Link Google before confirming with Google.')
  const nonce = randomBytes(32).toString('base64url')
  const { internalAdapter } = await auth.$context
  await internalAdapter.createVerificationValue({
    identifier: `google-reauth:${nonce}`,
    value: JSON.stringify({ ...args.input, userId: args.userId, startedAt: Date.now() }),
    expiresAt: new Date(Date.now() + 10 * 60_000),
  })
  const url = new URL('/desktop/authorize', args.webOrigin)
  url.search = new URLSearchParams({
    redirect_uri: args.input.redirectUri,
    code_challenge: args.input.codeChallenge,
    code_challenge_method: 'S256',
    state: args.input.state,
    google_reauth: nonce,
    google_start: '1',
  }).toString()
  return url.toString()
}

export const confirmGoogleReauth = async (args: {
  nonce: string
  userId: string
  sessionCreatedAt: Date | undefined
  sessionId: string
  redirectUri: string
  codeChallenge: string
}): Promise<void> => {
  const { internalAdapter } = await auth.$context
  const row = await internalAdapter.consumeVerificationValue(`google-reauth:${args.nonce}`)
  if (row === null) throw new BadRequestException('Google confirmation expired. Try again.')
  const pending = pendingSchema.parse(JSON.parse(row.value))
  const proof = await internalAdapter.consumeVerificationValue(`google-session:${args.sessionId}`)
  if (
    proof?.value !== args.userId ||
    pending.userId !== args.userId ||
    pending.redirectUri !== args.redirectUri ||
    pending.codeChallenge !== args.codeChallenge ||
    args.sessionCreatedAt === undefined ||
    args.sessionCreatedAt.getTime() < pending.startedAt
  ) {
    throw new BadRequestException('Sign in again with the Google account linked to Atlas.')
  }
}
