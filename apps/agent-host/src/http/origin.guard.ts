import {
  ForbiddenException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common'

import type { AgentHostEnv } from '../config/env'
import { AGENT_HOST_ENV } from '../host/tokens'
import { headerOf, type HostRequest } from './host-request'

@Injectable()
export class OriginGuard implements CanActivate {
  constructor(@Inject(AGENT_HOST_ENV) private readonly env: AgentHostEnv) {}

  canActivate(context: ExecutionContext): boolean {
    const trusted = this.env.trustedOrigins
    if (trusted.length === 0) return true
    const origin = headerOf(context.switchToHttp().getRequest<HostRequest>(), 'origin')
    if (origin !== undefined && trusted.includes(origin)) return true
    throw new ForbiddenException({ reason: 'origin' })
  }
}
