import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import { BaseExceptionFilter } from '@nestjs/core'
import { Prisma } from '../generated/prisma/client'
import { GithubUserReadFailed } from './cloud/github/github-user-reads'

const UPSTREAM_TIMEOUT_MESSAGE = 'upstream request timed out'
const TIMEOUT_ERROR_NAMES: readonly string[] = ['TimeoutError', 'AbortError']

const PRISMA_UNIQUE_VIOLATION = 'P2002'
const PRISMA_RECORD_NOT_FOUND = 'P2025'

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
    code === undefined
      ? { statusCode: status, message }
      : { statusCode: status, message, code },
    status,
  )

// Only the code and a fixed message leave the process: Prisma's meta carries column values.
const prismaFailure = (error: Prisma.PrismaClientKnownRequestError): HttpException => {
  if (error.code === PRISMA_UNIQUE_VIOLATION) {
    return failure({ status: HttpStatus.CONFLICT, message: 'Resource already exists', code: error.code })
  }
  if (error.code === PRISMA_RECORD_NOT_FOUND) {
    return failure({ status: HttpStatus.NOT_FOUND, message: 'Resource not found', code: error.code })
  }
  return failure({ status: HttpStatus.BAD_REQUEST, message: 'Invalid request', code: error.code })
}

@Catch()
export class GlobalExceptionFilter extends BaseExceptionFilter {
  private readonly log = new Logger(GlobalExceptionFilter.name)

  override catch(exception: unknown, host: ArgumentsHost): void {
    super.catch(this.mapped({ exception }), host)
  }

  private mapped({ exception }: { exception: unknown }): unknown {
    if (exception instanceof HttpException) return exception

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      this.log.warn(`prisma ${exception.code} mapped to an http error`)
      return prismaFailure(exception)
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
