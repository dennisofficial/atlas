import type { IncomingMessage } from 'node:http'
import type { Db } from '@dltech/atlas-db'
import { fromNodeHeaders } from 'better-auth/node'
import { AwaitingAccessError } from '../../../_core/errors/awaiting-access.error'
import type { SessionVerifier, SessionVerifyOptions } from '../../../_core/ports/session-verifier'
import type { VerifiedSession } from '../../../_core/types/auth.types'
import { auth } from './auth.server'

export class BetterAuthSessionVerifier implements SessionVerifier {
  constructor(private readonly args: { db: Db }) {}

  async verify(
    request: Pick<IncomingMessage, 'headers'>,
    options: SessionVerifyOptions = {},
  ): Promise<VerifiedSession | null> {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) })
    if (!session) return null

    const user = await this.args.db.orm.public.User.first({ id: session.user.id })
    if (user === null) return null
    if (user.active !== true && options.allowInactive !== true) throw new AwaitingAccessError()

    return {
      userId: session.user.id,
      sessionId: session.session.id,
      email: session.user.email,
      sessionCreatedAt: new Date(session.session.createdAt),
    }
  }
}
