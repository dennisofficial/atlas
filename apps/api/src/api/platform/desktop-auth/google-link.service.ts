import { randomBytes } from 'node:crypto'
import { db } from '@dltech/atlas-db'
import { EReturnResult } from '@dltech/atlas-core'
import { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import { BadRequestException, Injectable } from '@nestjs/common'
import { z } from 'zod'
import { BrowserReturnService } from '../../../agent'
import { EnvService } from '../../../_core/config/env/env.service'
import { auth } from '../auth/auth.server'

const ticketSchema = z.object({ token: z.string(), userId: z.string() })
const callbackSchema = z.object({ userId: z.string() })
const CALLBACK_PATH = '/google-link/callback'
const WEB_PATH = '/settings/account'

@Injectable()
export class GoogleLinkService {
  private readonly cipher: SecretCipher
  private readonly returns: BrowserReturnService

  constructor(private readonly env: EnvService) {
    this.cipher = new SecretCipher(env.get('SECRETS_ENCRYPTION_KEY'))
    this.returns = new BrowserReturnService({
      db,
      cipher: this.cipher,
      publicUrl: env.get('BETTER_AUTH_URL'),
      webOrigin: env.get('WEB_ORIGIN'),
    })
  }

  async begin(args: { sessionId: string; userId: string }): Promise<string> {
    const session = await db.orm.public.AuthSession.first({ id: args.sessionId })
    if (session === null || session.userId !== args.userId || session.expiresAt <= new Date()) {
      throw new BadRequestException('Sign in again before linking Google.')
    }
    const state = randomBytes(32).toString('base64url')
    const { internalAdapter } = await auth.$context
    const expiresAt = new Date(Date.now() + 10 * 60_000)
    await internalAdapter.createVerificationValue({
      identifier: `google-link-start:${state}`,
      value: this.cipher.encrypt(JSON.stringify({ token: session.token, userId: args.userId })),
      expiresAt,
    })
    await internalAdapter.createVerificationValue({
      identifier: `google-link-callback:${state}`,
      value: JSON.stringify({ userId: args.userId }),
      expiresAt,
    })
    const started = await this.returns.begin({
      state,
      flow: 'google-link',
      userId: args.userId,
      providerUrl: `${this.env.get('BETTER_AUTH_URL')}/google-link/start?state=${state}`,
      callbackPath: CALLBACK_PATH,
      webPath: WEB_PATH,
    })
    return started.startUrl
  }

  async start(state: string): Promise<Response> {
    const context = await auth.$context
    const row = await context.internalAdapter.consumeVerificationValue(`google-link-start:${state}`)
    if (row === null) throw new BadRequestException('Google linking expired. Try again.')
    const ticket = ticketSchema.parse(JSON.parse(this.cipher.decrypt(row.value)))
    const callbackURL = `${this.env.get('BETTER_AUTH_URL')}${CALLBACK_PATH}?state=${encodeURIComponent(state)}`
    const started = await auth.api.linkSocialAccount({
      headers: new Headers({ authorization: `Bearer ${ticket.token}` }),
      body: { provider: 'google', callbackURL, errorCallbackURL: callbackURL },
      asResponse: true,
    })
    if (!started.ok) throw new BadRequestException('Google linking failed. Try again.')
    const { url } = z.object({ url: z.url() }).parse(await started.json())
    const stateCookieName = context.createAuthCookie(
      context.oauthConfig.storeStateStrategy === 'cookie' ? 'oauth_state' : 'state',
    ).name
    const headers = new Headers()
    for (const cookie of started.headers.getSetCookie()) {
      if (cookie.slice(0, cookie.indexOf('=')) === stateCookieName) {
        headers.append('set-cookie', cookie)
      }
    }
    return Response.json({ url }, { headers })
  }

  async callback(args: {
    state: string
    error: string | undefined
    cookieHeader: string | undefined
  }) {
    const { internalAdapter } = await auth.$context
    const row = await internalAdapter.consumeVerificationValue(`google-link-callback:${args.state}`)
    let connected = false
    if (row !== null && args.error === undefined) {
      const pending = callbackSchema.parse(JSON.parse(row.value))
      connected =
        (await db.orm.public.Account.first({ userId: pending.userId, providerId: 'google' })) !==
        null
    }
    return this.returns.answer({
      state: args.state,
      cookieHeader: args.cookieHeader,
      outcome: connected
        ? { result: EReturnResult.Connected }
        : { result: EReturnResult.Failed, reason: args.error ?? 'link_failed' },
      fallbackWebPath: WEB_PATH,
    })
  }
}
