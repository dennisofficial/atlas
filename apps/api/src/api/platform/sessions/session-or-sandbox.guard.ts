import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { IS_PUBLIC_KEY } from '../../../_core/decorators/public.decorator'
import { SANDBOX_REACHABLE_KEY } from '../../../_core/decorators/sandbox-reachable.decorator'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import type { SessionVerifier } from '../../../_core/ports/session-verifier'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SandboxesService } from '../sandboxes/sandboxes.service'

const threadIdOf = (request: Request): string | undefined => {
  const value = request.params.threadId
  if (typeof value !== 'string' || value.length === 0) return undefined
  return value
}

const bearerTokenOf = (request: Request): string | undefined => {
  const header = request.headers.authorization
  if (typeof header !== 'string') return undefined
  const [scheme, value] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer') return undefined
  if (value === undefined || value.length === 0) return undefined
  return value
}

/**
 * The sessions routes serve two principals for the same thread: the operator (a better-auth
 * session) and the sandbox running that thread (its session token, the same one the heartbeat,
 * workspace, and serve-binary routes already trust).
 *
 * A sandbox token is a machine credential any process inside the sandbox can read, so it never
 * authenticates as the owner at large: on a route naming `:threadId` it reaches only that
 * thread's family (the sandbox's own thread plus its sub-agent threads), and on a threadless
 * route it is refused unless the route opts in with `@SandboxReachable()`. Anything else falls
 * through to the user session.
 */
@Injectable()
export class SessionOrSandboxGuard implements CanActivate {
  constructor(
    @Inject(SESSION_VERIFIER) private readonly verifier: SessionVerifier,
    private readonly reflector: Reflector,
    private readonly sandboxes: SandboxesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const threadId = threadIdOf(request)
    const token = bearerTokenOf(request)

    if (token !== undefined) {
      const row = await this.sandboxes.verifyTokenPrincipal({ token }).catch(() => null)
      if (row !== null) {
        if (threadId !== undefined) {
          await this.sandboxes.assertThreadInFamily({ sandboxThreadId: row.threadId, threadId })
        } else if (!this.sandboxReachable(context)) {
          throw new ForbiddenException('a sandbox session token does not reach this route')
        }
        request.auth = {
          userId: row.userId,
          sessionId: `sandbox:${row.id}`,
          email: '',
          activeOrganizationId: null,
        }
        request.sandbox = { sandboxId: row.id, threadId: row.threadId }
        return true
      }
    }

    const session = await this.verifier.verify(request)
    if (!session) throw new UnauthorizedException('a valid session is required')

    request.auth = session
    return true
  }

  private sandboxReachable(context: ExecutionContext): boolean {
    return this.reflector.getAllAndOverride<boolean>(SANDBOX_REACHABLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) === true
  }
}
