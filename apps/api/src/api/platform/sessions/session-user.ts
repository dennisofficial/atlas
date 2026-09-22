import { UnauthorizedException } from '@nestjs/common'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'

export function userIdOf(request: AuthenticatedRequest): string {
  const auth = request.auth
  if (!auth) throw new UnauthorizedException('a valid session is required')
  return auth.userId
}
