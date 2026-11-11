import { HttpException, HttpStatus, type Logger } from '@nestjs/common'
import { TRPCError } from '@trpc/server'
import type { TRPC_ERROR_CODE_KEY } from '@trpc/server/rpc'
import { mapToHttpException } from '../../api/http-exception-mapping'

const INTERNAL_MESSAGE = 'Internal server error'

const MAX_CAUSE_DEPTH = 8

const CODE_BY_STATUS: ReadonlyMap<number, TRPC_ERROR_CODE_KEY> = new Map([
  [HttpStatus.BAD_REQUEST, 'BAD_REQUEST'],
  [HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED'],
  [HttpStatus.FORBIDDEN, 'FORBIDDEN'],
  [HttpStatus.NOT_FOUND, 'NOT_FOUND'],
  [HttpStatus.CONFLICT, 'CONFLICT'],
  [HttpStatus.PAYLOAD_TOO_LARGE, 'PAYLOAD_TOO_LARGE'],
  [HttpStatus.PRECONDITION_FAILED, 'PRECONDITION_FAILED'],
  [HttpStatus.UNPROCESSABLE_ENTITY, 'UNPROCESSABLE_CONTENT'],
  [HttpStatus.TOO_MANY_REQUESTS, 'TOO_MANY_REQUESTS'],
  [HttpStatus.BAD_GATEWAY, 'BAD_GATEWAY'],
  [HttpStatus.SERVICE_UNAVAILABLE, 'SERVICE_UNAVAILABLE'],
  [HttpStatus.GATEWAY_TIMEOUT, 'GATEWAY_TIMEOUT'],
])

export const isTrpcError = (value: unknown): value is Error & { code: string } =>
  value instanceof Error && value.name === 'TRPCError' && 'code' in value

export const trpcCodeOf = ({ status }: { status: number }): TRPC_ERROR_CODE_KEY =>
  CODE_BY_STATUS.get(status) ?? 'INTERNAL_SERVER_ERROR'

const describe = (failure: unknown): string => {
  if (failure instanceof Error) return failure.stack ?? `${failure.name}: ${failure.message}`
  if (typeof failure === 'string') return failure
  try {
    return JSON.stringify(failure)
  } catch {
    return String(failure)
  }
}

const describeCauseChain = (failure: unknown): string => {
  const parts: string[] = []
  let current: unknown = failure
  while (parts.length < MAX_CAUSE_DEPTH && current !== undefined && current !== null) {
    parts.push(describe(current))
    current = current instanceof Error ? current.cause : undefined
  }
  return parts.join('\nCaused by: ')
}

const logWarningsOnly = (log: Pick<Logger, 'warn' | 'error'>): Pick<Logger, 'warn' | 'error'> => ({
  warn: (message: unknown) => log.warn(message),
  error: () => undefined,
})

export function toTrpcError({
  failure,
  log,
}: {
  failure: unknown
  log: Pick<Logger, 'warn' | 'error'>
}): TRPCError {
  const mapped = mapToHttpException({ exception: failure, log: logWarningsOnly(log) })
  const status = mapped instanceof HttpException ? mapped.getStatus() : mapped.statusCode
  const isServerFault = status >= HttpStatus.INTERNAL_SERVER_ERROR
  if (isServerFault) log.error(describeCauseChain(failure))
  return new TRPCError({
    code: trpcCodeOf({ status }),
    message: isServerFault ? INTERNAL_MESSAGE : mapped.message,
    cause: mapped,
  })
}

export const detailsOf = (cause: unknown): Record<string, unknown> | undefined => {
  if (cause instanceof HttpException && cause.getStatus() < HttpStatus.INTERNAL_SERVER_ERROR) {
    const response = cause.getResponse()
    return typeof response === 'object' ? { ...response } : undefined
  }
  return undefined
}
