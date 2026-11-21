import { ArgumentsHost, Catch, Logger } from '@nestjs/common'
import { BaseExceptionFilter } from '@nestjs/core'
import { mapToHttpException } from './http-exception-mapping'
import { requestScopedLog } from './request-id.middleware'

@Catch()
export class GlobalExceptionFilter extends BaseExceptionFilter {
  private readonly log = new Logger(GlobalExceptionFilter.name)

  override catch(exception: unknown, host: ArgumentsHost): void {
    super.catch(mapToHttpException({ exception, log: requestScopedLog(this.log) }), host)
  }
}
