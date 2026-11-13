import type { LogPort } from '@dltech/atlas-observability'
import { z } from 'zod'

import type { OperatorRequestOutcome, OperatorRequestRegistry } from './registry'

export const OPERATOR_ANSWER_PATH = '/operator-requests/answer'

const MAX_VALUE_LENGTH = 64 * 1024

const answerBodySchema = z.strictObject({
  sessionId: z.string().min(1),
  callId: z.string().min(1),
  value: z.string().max(MAX_VALUE_LENGTH),
})

const cancelBodySchema = z.strictObject({
  sessionId: z.string().min(1),
  callId: z.string().min(1),
  cancel: z.literal(true),
})

const requestBodySchema = z.union([answerBodySchema, cancelBodySchema])

export type OperatorAnswerRouteArgs = {
  registry: OperatorRequestRegistry
  resolve: (bearer: string) => Promise<{ userId: string } | undefined>
  trustedOrigins: readonly string[]
  log?: LogPort | undefined
}

const corsOriginOf = (args: {
  request: Request
  trusted: readonly string[]
}): string | undefined => {
  const origin = args.request.headers.get('origin')
  if (origin === null) return undefined
  if (args.trusted.length === 0 || args.trusted.includes(origin)) return origin
  return undefined
}

const corsHeadersOf = (origin: string | undefined): Record<string, string> =>
  origin === undefined
    ? {}
    : {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-max-age': '600',
        vary: 'origin',
      }

const answerOf = (args: { status: number; body: unknown; origin: string | undefined }): Response =>
  Response.json(args.body, {
    status: args.status,
    headers: { 'cache-control': 'no-store', ...corsHeadersOf(args.origin) },
  })

const bearerOf = (request: Request): string | undefined => {
  const header = request.headers.get('authorization')
  if (header === null) return undefined
  const [scheme, token] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || token === undefined || token === '') return undefined
  return token
}

const refusalOf = (args: {
  outcome: OperatorRequestOutcome
  origin: string | undefined
  log: LogPort | undefined
}): Response => {
  if (args.outcome.ok) return answerOf({ status: 200, body: {}, origin: args.origin })
  args.log?.info({
    source: 'operator.answer',
    message: 'an operator answer was refused',
    data: { status: args.outcome.status, reason: args.outcome.reason },
  })
  return answerOf({
    status: args.outcome.status,
    body: { reason: args.outcome.reason },
    origin: args.origin,
  })
}

export const operatorAnswerOf = (args: OperatorAnswerRouteArgs) => {
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url)
    if (url.pathname !== OPERATOR_ANSWER_PATH) return null
    const origin = corsOriginOf({ request, trusted: args.trustedOrigins })
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: corsHeadersOf(origin) })
    if (request.method !== 'POST')
      return answerOf({ status: 405, body: { reason: 'method' }, origin })
    if (origin === undefined && args.trustedOrigins.length > 0)
      return answerOf({ status: 403, body: { reason: 'origin' }, origin })

    const bearer = bearerOf(request)
    if (bearer === undefined) return answerOf({ status: 401, body: { reason: 'bearer' }, origin })
    const principal = await args.resolve(bearer)
    if (principal === undefined)
      return answerOf({ status: 401, body: { reason: 'bearer' }, origin })

    const parsed = requestBodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return answerOf({ status: 400, body: { reason: 'body' }, origin })
    const body = parsed.data

    const outcome =
      'cancel' in body
        ? await args.registry.cancel({
            sessionId: body.sessionId,
            callId: body.callId,
            userId: principal.userId,
          })
        : await args.registry.answer({
            sessionId: body.sessionId,
            callId: body.callId,
            userId: principal.userId,
            value: body.value,
          })
    return refusalOf({ outcome, origin, log: args.log })
  }
}
