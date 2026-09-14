import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { IS_PUBLIC_KEY } from '@core/decorators/public.decorator'
import type { SessionVerifier } from '@core/ports/session-verifier'
import { SESSION_VERIFIER } from '@core/ports/session-verifier'
import type { AuthenticatedRequest } from '@core/types/auth.types'

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    @Inject(SESSION_VERIFIER) private readonly verifier: SessionVerifier,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const session = await this.verifier.verify(request)
    if (!session) throw new UnauthorizedException('a valid session is required')

    request.auth = session
    return true
  }
}
