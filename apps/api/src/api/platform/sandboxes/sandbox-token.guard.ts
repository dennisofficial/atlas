import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { POD_REACHABLE_KEY } from '../../../_core/decorators/pod-reachable.decorator'
import type { Request } from 'express'
import { SandboxesService } from './sandboxes.service'
import { ETokenPrincipalKind } from './token-principal'

export interface SandboxAuthenticatedRequest extends Request {
  sandbox?: { threadId: string; userId: string }
}

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
 * A route named by `:threadId` verifies the bearer token against that exact thread. A route
 * with no thread in its path (the sandbox-side context download) instead resolves the sandbox
 * the token itself names, and stashes its thread onto the request for the handler to read.
 */
@Injectable()
export class SandboxTokenGuard implements CanActivate {
  constructor(
    private readonly sandboxes: SandboxesService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SandboxAuthenticatedRequest>()
    const threadId = threadIdOf(request)
    const token = bearerTokenOf(request)
    if (token === undefined) {
      throw new UnauthorizedException('a sandbox session token is required')
    }

    if (threadId !== undefined) {
      const row = await this.sandboxes.verifySessionToken({ threadId, token })
      request.sandbox = { threadId, userId: row.userId }
      return true
    }

    const row = await this.sandboxes.verifyTokenPrincipal({ token })
    if (row.kind === ETokenPrincipalKind.Pod && !this.podReachable(context)) {
      throw new UnauthorizedException('a sandbox session token is required')
    }
    request.sandbox = { threadId: row.threadId, userId: row.userId }
    return true
  }

  private podReachable(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(POD_REACHABLE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    )
  }
}
