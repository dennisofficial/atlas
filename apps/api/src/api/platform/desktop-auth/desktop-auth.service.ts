import { createHash, randomBytes } from 'node:crypto'
import { BadRequestException, Injectable } from '@nestjs/common'
import type { AuthorizeDesktopInput, ExchangeDesktopCodeInput } from '@dltech/atlas-wire'
import { needsTrustedOrigin } from '@dltech/atlas-wire'
import { z } from 'zod'
import { EnvService } from '../../../_core/config/env/env.service'
import { auth } from '../auth/auth.server'
import { beginGoogleReauth, confirmGoogleReauth } from './google-reauth'
import { trustedOriginsOf } from './trusted-origins'

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
  constructor(private readonly env: EnvService) {}

  async beginGoogleReauth(args: {
    userId: string
    input: import('@dltech/atlas-wire').BeginGoogleReauthInput
  }): Promise<string> {
    this.checkRedirect(args.input.redirectUri)
    return beginGoogleReauth({ ...args, webOrigin: this.env.get('WEB_ORIGIN') })
  }

  private checkRedirect(redirectUri: string): void {
    if (needsTrustedOrigin(redirectUri)) {
      const origin = new URL(redirectUri).origin
      if (!trustedOriginsOf(this.env).has(origin)) {
        throw new BadRequestException('redirect origin is not trusted')
      }
    }
  }

  async authorize(args: {
    userId: string
    input: AuthorizeDesktopInput
    sessionCreatedAt?: Date | undefined
    sessionId?: string | undefined
  }): Promise<string> {
    this.checkRedirect(args.input.redirectUri)
    if (args.input.googleReauth !== undefined) {
      await confirmGoogleReauth({
        nonce: args.input.googleReauth,
        userId: args.userId,
        sessionCreatedAt: args.sessionCreatedAt,
        sessionId: args.sessionId ?? '',
        redirectUri: args.input.redirectUri,
        codeChallenge: args.input.codeChallenge,
      })
    }
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
