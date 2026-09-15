import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { HttpException, Injectable, InternalServerErrorException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { MIN_CLIENT_VERSION_KEY } from '../../_core/decorators/min-client-version.decorator'
import { isBelowMinimum, parseClientVersion } from '../../_lib/version/client-version'
import type { Request } from 'express'

const UPGRADE_REQUIRED = 426

@Injectable()
export class ClientVersionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const minimum = this.reflector.getAllAndOverride<string>(MIN_CLIENT_VERSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (minimum === undefined) return true

    const minimumVersion = parseClientVersion(minimum)
    if (!minimumVersion) {
      throw new InternalServerErrorException(
        `@MinClientVersion('${minimum}') does not parse as a version`,
      )
    }

    const request = context.switchToHttp().getRequest<Request>()
    const raw = request.headers['atlas-client-version']
    const received = typeof raw === 'string' ? parseClientVersion(raw) : null
    if (!received) return true

    if (!isBelowMinimum({ minimum: minimumVersion, received })) return true

    throw new HttpException(
      {
        code: 'client-update-required',
        message: `update Atlas to continue — this needs at least v${minimum}`,
        minimum,
        received: raw,
      },
      UPGRADE_REQUIRED,
    )
  }
}
