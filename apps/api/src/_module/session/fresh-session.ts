import { REAUTH_REQUIRED_CODE } from '@dltech/atlas-wire/web'
import { ForbiddenException } from '@nestjs/common'
import type { VerifiedSession } from '../../_core/types/auth.types'

export const FRESH_SESSION_WINDOW_MS = 60 * 60 * 1000

export function assertFreshSession(args: { auth: VerifiedSession; now?: Date }): void {
  const createdAt = args.auth.sessionCreatedAt
  const now = (args.now ?? new Date()).getTime()
  if (createdAt !== undefined && now - createdAt.getTime() < FRESH_SESSION_WINDOW_MS) return
  throw new ForbiddenException({
    statusCode: 403,
    message: REAUTH_REQUIRED_CODE,
    code: REAUTH_REQUIRED_CODE,
  })
}
