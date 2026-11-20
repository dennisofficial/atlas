import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { Logger } from '@nestjs/common'
import type { Request, RequestHandler } from 'express'

export const REQUEST_ID_HEADER = 'x-request-id'

const CALLER_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/
const REFERENCE_LENGTH = 24

const requests = new AsyncLocalStorage<string>()

export function currentRequestId(): string | undefined {
  return requests.getStore()
}

const headerValueOf = (value: string | string[] | undefined): string | undefined => {
  const candidate = Array.isArray(value) ? value.at(0) : value
  if (candidate === undefined) return undefined
  return CALLER_REQUEST_ID.test(candidate) ? candidate : undefined
}

export const newRequestId = (): string =>
  `req_${randomUUID().replaceAll('-', '').slice(0, REFERENCE_LENGTH)}`

export const requestIdOf = (request: Pick<Request, 'headers'>): string =>
  headerValueOf(request.headers[REQUEST_ID_HEADER]) ?? newRequestId()

export const withRequestId = <T>(requestId: string, run: () => T): T => requests.run(requestId, run)

export function requestIdMiddleware(): RequestHandler {
  return (request, response, next) => {
    const requestId = requestIdOf(request)
    response.setHeader(REQUEST_ID_HEADER, requestId)
    requests.run(requestId, next)
  }
}

const scoped = (requestId: string, message: unknown): string => {
  const body =
    message instanceof Error ? (message.stack ?? `${message.name}: ${message.message}`) : message
  return `${requestId} ${String(body)}`
}

export function requestScopedLog(
  log: Pick<Logger, 'warn' | 'error'>,
): Pick<Logger, 'warn' | 'error'> {
  const requestId = currentRequestId()
  if (requestId === undefined) return log
  return {
    warn: (message: unknown) => log.warn(scoped(requestId, message)),
    error: (message: unknown) => log.error(scoped(requestId, message)),
  }
}
