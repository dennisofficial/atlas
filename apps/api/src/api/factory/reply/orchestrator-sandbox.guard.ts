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
 * The reply route answers the orchestrator sandbox and nothing else: a user session carries no
 * sandbox row, so there is no work item to attribute a reply to and the request fails here.
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
