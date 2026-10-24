import { Injectable } from '@nestjs/common'
import type { TRPCContext } from 'nestjs-trpc'
import type { CreateExpressContextOptions } from '@trpc/server/adapters/express'
import type { Request } from 'express'

export type ApiTrpcCtx = {
  req: Request
  bearerToken: string | undefined
  clientVersion: string | undefined
}

export const isApiTrpcCtx = (value: object): value is ApiTrpcCtx =>
  'req' in value && 'bearerToken' in value && 'clientVersion' in value

const bearerTokenOf = (request: Request): string | undefined => {
  const header = request.headers.authorization
  if (typeof header !== 'string') return undefined
  const [scheme, value] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer') return undefined
  if (value === undefined || value.length === 0) return undefined
  return value
}

const clientVersionOf = (request: Request): string | undefined => {
  const header = request.headers['atlas-client-version']
  return typeof header === 'string' ? header : undefined
}

@Injectable()
export class ApiTrpcContext implements TRPCContext {
  create({ req, res }: CreateExpressContextOptions): ApiTrpcCtx {
    res.setHeader('cache-control', 'no-store')
    return { req, bearerToken: bearerTokenOf(req), clientVersion: clientVersionOf(req) }
  }
}
