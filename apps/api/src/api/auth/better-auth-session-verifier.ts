import type { IncomingMessage } from 'node:http'
import { Injectable } from '@nestjs/common'
import type { SessionVerifier } from '../../_core/ports/session-verifier'
import type { VerifiedSession } from '../../_core/types/auth.types'
import { fromNodeHeaders } from 'better-auth/node'
import { auth } from './auth.server'

@Injectable()
export class BetterAuthSessionVerifier implements SessionVerifier {
  async verify(
    request: Pick<IncomingMessage, 'headers'>,
  ): Promise<VerifiedSession | null> {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    })
    if (!session) return null

    return {
      userId: session.user.id,
      sessionId: session.session.id,
      email: session.user.email,
      activeOrganizationId: session.session.activeOrganizationId ?? null,
    }
  }
}
