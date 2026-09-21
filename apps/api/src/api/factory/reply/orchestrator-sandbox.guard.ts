import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { Injectable, UnauthorizedException } from '@nestjs/common'
import type { Request } from 'express'
import type { CloudSandboxModel } from '../../../db'
import { SandboxesService } from '../../sandboxes/sandboxes.service'

export type OrchestratorSandboxRequest = Request & { orchestratorSandbox?: CloudSandboxModel }

const bearerTokenOf = (request: Request): string | undefined => {
  const header = request.headers.authorization
  if (typeof header !== 'string') return undefined
  const [scheme, value] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || value === undefined || value.length === 0) {
    return undefined
  }
  return value
}

/**
 * The reply route authenticates a live sandbox session token and nothing else — a better-auth
 * user session never gets through. Any live sandbox passes this gate; the authorization half
 * (this thread orchestrates this work item, and the target surface is its alias) is
 * GuardedReplyService's, where the work-item resolution lives.
 */
@Injectable()
export class OrchestratorSandboxGuard implements CanActivate {
  constructor(private readonly sandboxes: SandboxesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OrchestratorSandboxRequest>()
    const token = bearerTokenOf(request)
    if (token === undefined) {
      throw new UnauthorizedException('a sandbox session token is required')
    }
    const row = await this.sandboxes
      .verifyTokenPrincipal({ token })
      .catch(() => null)
    if (row === null) {
      throw new UnauthorizedException('a sandbox session token is required')
    }
    request.orchestratorSandbox = row
    return true
  }
}
