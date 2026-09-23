import { BadRequestException, UnauthorizedException } from '@nestjs/common'
import type { AuthenticatedRequest } from '../../_core/types/auth.types'

export function requireOrganization(request: AuthenticatedRequest): string {
  const auth = request.auth
  if (!auth) throw new UnauthorizedException('a valid session is required')
  if (auth.activeOrganizationId === null) {
    throw new BadRequestException('an active organization is required')
  }
  return auth.activeOrganizationId
}
