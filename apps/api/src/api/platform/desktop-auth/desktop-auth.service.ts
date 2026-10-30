import { createHash, randomBytes } from 'node:crypto'
import { BadRequestException, Injectable } from '@nestjs/common'
import type { AuthorizeDesktopInput, ExchangeDesktopCodeInput } from '@dltech/atlas-wire'
import { z } from 'zod'
import { auth } from '../auth/auth.server'

export const CODE_TTL_MS = 60_000
const INVALID_GRANT = 'the authorization code is invalid, expired or already used'

const grantSchema = z.object({
  userId: z.string(),
  codeChallenge: z.string(),
  redirectUri: z.string(),
})

const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest()
const identifierOf = (code: string): string => `desktop-auth:${sha256(code).toString('hex')}`

// https://datatracker.ietf.org/doc/html/rfc7636#section-4.6
export const challengeOf = (verifier: string): string => sha256(verifier).toString('base64url')

@Injectable()
export class DesktopAuthService {
  async authorize(args: { userId: string; input: AuthorizeDesktopInput }): Promise<string> {
    const code = randomBytes(32).toString('base64url')
    const { internalAdapter } = await auth.$context
    await internalAdapter.createVerificationValue({
      identifier: identifierOf(code),
      value: JSON.stringify({
        userId: args.userId,
        codeChallenge: args.input.codeChallenge,
        redirectUri: args.input.redirectUri,
      }),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    })
    return code
  }

  async exchange(input: ExchangeDesktopCodeInput): Promise<string> {
    const { internalAdapter } = await auth.$context
    const row = await internalAdapter.consumeVerificationValue(identifierOf(input.code))
    if (row === null) throw new BadRequestException(INVALID_GRANT)
    const grant = grantSchema.safeParse(JSON.parse(row.value))
    if (!grant.success) throw new BadRequestException(INVALID_GRANT)
    if (grant.data.redirectUri !== input.redirectUri) throw new BadRequestException(INVALID_GRANT)
    if (challengeOf(input.codeVerifier) !== grant.data.codeChallenge) {
      throw new BadRequestException(INVALID_GRANT)
    }
    const session = await internalAdapter.createSession(grant.data.userId)
    return session.token
  }
}
