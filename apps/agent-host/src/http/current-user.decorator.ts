import { createParamDecorator, type ExecutionContext } from '@nestjs/common'

import type { HostRequest } from './host-request'

export const CurrentUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined =>
    context.switchToHttp().getRequest<HostRequest>().userId,
)
