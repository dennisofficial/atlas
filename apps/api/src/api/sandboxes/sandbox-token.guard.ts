import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { Injectable, UnauthorizedException } from '@nestjs/common'
import type { Request } from 'express'
import { SandboxesService } from './sandboxes.service'

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

@Injectable()
export class SandboxTokenGuard implements CanActivate {
  constructor(private readonly sandboxes: SandboxesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>()
    const threadId = threadIdOf(request)
    const token = bearerTokenOf(request)
    if (threadId === undefined || token === undefined) {
      throw new UnauthorizedException('a sandbox session token is required')
    }
    await this.sandboxes.verifySessionToken({ threadId, token })
    return true
  }
}
