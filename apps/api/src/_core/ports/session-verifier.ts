import type { IncomingMessage } from 'node:http'
import type { VerifiedSession } from '../types/auth.types'

export const SESSION_VERIFIER = Symbol('SESSION_VERIFIER')

export interface SessionVerifyOptions {
  allowInactive?: boolean
}

export interface SessionVerifier {
  verify(
    request: Pick<IncomingMessage, 'headers'>,
    options?: SessionVerifyOptions,
  ): Promise<VerifiedSession | null>
}
