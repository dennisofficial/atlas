import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger } from '@nestjs/common'
import { BaseExceptionFilter } from '@nestjs/core'
import { databaseErrorCode, isNoRows, isUniqueViolation } from '@dltech/atlas-db'
import { GithubUserReadFailed } from './cloud/github/github-user-reads'

const UPSTREAM_TIMEOUT_MESSAGE = 'upstream request timed out'
const TIMEOUT_ERROR_NAMES: readonly string[] = ['TimeoutError', 'AbortError']

const CLIENT_DATA_ERROR_CLASSES: readonly string[] = ['22', '23']

const isOutboundTimeout = (exception: unknown): boolean =>
  exception instanceof DOMException && TIMEOUT_ERROR_NAMES.includes(exception.name)

// body-parser and other http-errors carry a 4xx statusCode and a client-safe message; Nest's
// default reply already handles them, so mapping them to 500 would turn a 413 into a server fault.
const isClientHttpError = (exception: unknown): boolean => {
  if (typeof exception !== 'object' || exception === null) return false
  const { statusCode, message } = exception as { statusCode?: unknown; message?: unknown }
  return (
    typeof statusCode === 'number' &&
    statusCode >= 400 &&
    statusCode < 500 &&
    typeof message === 'string'
  )
}

const failure = ({
  status,
  message,
  code,
}: {
  status: HttpStatus
  message: string
  code?: string
}): HttpException =>
  new HttpException(
    code === undefined ? { statusCode: status, message } : { statusCode: status, message, code },
    status,
  )

const databaseFailure = (exception: unknown): HttpException | undefined => {
  if (isNoRows(exception))
    return failure({ status: HttpStatus.NOT_FOUND, message: 'Resource not found' })
  const code = databaseErrorCode(exception)
  if (code === undefined) return undefined
  if (isUniqueViolation(exception)) {
    return failure({ status: HttpStatus.CONFLICT, message: 'Resource already exists', code })
  }
  if (CLIENT_DATA_ERROR_CLASSES.includes(code.slice(0, 2))) {
    return failure({ status: HttpStatus.BAD_REQUEST, message: 'Invalid request', code })
  }
  return undefined
}

@Catch()
export class GlobalExceptionFilter extends BaseExceptionFilter {
  private readonly log = new Logger(GlobalExceptionFilter.name)

  override catch(exception: unknown, host: ArgumentsHost): void {
    super.catch(this.mapped({ exception }), host)
  }

  private mapped({ exception }: { exception: unknown }): unknown {
    if (exception instanceof HttpException) return exception

    const database = databaseFailure(exception)
    if (database !== undefined) {
      this.log.warn(`database error mapped to http ${database.getStatus()}`)
      return database
    }

    if (exception instanceof GithubUserReadFailed) {
      this.log.warn(`github read failed with ${exception.status}: ${exception.message}`)
      return failure({ status: HttpStatus.BAD_GATEWAY, message: exception.message })
    }

    if (isOutboundTimeout(exception)) {
      this.log.warn(UPSTREAM_TIMEOUT_MESSAGE)
      return failure({ status: HttpStatus.BAD_GATEWAY, message: UPSTREAM_TIMEOUT_MESSAGE })
    }

    if (isClientHttpError(exception)) return exception

    this.log.error(exception)
    return failure({ status: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Internal server error' })
  }
}
