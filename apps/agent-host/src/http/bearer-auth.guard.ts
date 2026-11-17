import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common'

import { STREAM_AUTH } from '../host/tokens'
import type { StreamAuthPort } from '../stream/stream-auth'
import { headerOf, type HostRequest } from './host-request'

export const bearerOf = (request: HostRequest): string | undefined => {
  const header = headerOf(request, 'authorization')
  if (header === undefined) return undefined
  const [scheme, token] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || token === undefined || token === '') return undefined
  return token
}

@Injectable()
export class BearerAuthGuard implements CanActivate {
  constructor(@Inject(STREAM_AUTH) private readonly auth: StreamAuthPort) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<HostRequest>()
    const bearer = bearerOf(request)
    if (bearer === undefined) return false
    const principal = await this.auth.resolve(bearer)
    if (principal === undefined) return false
    request.userId = principal.userId
    return true
  }
}
