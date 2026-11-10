import type { Db } from '@dltech/atlas-db'
import { z } from 'zod'

import type { SecretCipher } from '../config/secret-cipher'
import { serverUrlOf } from './server-url'
import { McpOauthStore } from './store'
import { mcpReturnScreenSchema, mcpReturnSurfaceSchema, type McpOauthGateway } from './types'

export const MCP_OAUTH_BEGIN_PATH = '/mcp-oauth/begin'

const beginRequestSchema = z.strictObject({
  serverId: z.string().min(1),
  surface: mcpReturnSurfaceSchema,
  screen: mcpReturnScreenSchema,
})

export type McpOauthBeginRouteArgs = {
  db: Db
  cipher: SecretCipher
  gateway: McpOauthGateway
  resolve: (bearer: string) => Promise<{ userId: string } | undefined>
  trustedOrigins: readonly string[]
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

export const mcpOauthBeginOf = (args: McpOauthBeginRouteArgs) => {
  const store = new McpOauthStore(args.db)

  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url)
    if (url.pathname !== MCP_OAUTH_BEGIN_PATH) return null
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

    const parsed = beginRequestSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return answerOf({ status: 400, body: { reason: 'body' }, origin })
    const body = parsed.data

    if (body.screen.kind === 'settings' && body.screen.scope === 'project') {
      const owner = await store.projectOwner({ projectId: body.screen.id })
      if (owner !== principal.userId)
        return answerOf({ status: 403, body: { reason: 'project' }, origin })
    }

    const row = await store.find({ id: body.serverId })
    if (row === null) return answerOf({ status: 404, body: { reason: 'server' }, origin })
    const owned =
      row.userId === null
        ? row.projectId !== null &&
          (await store.projectOwner({ projectId: row.projectId })) === principal.userId
        : row.userId === principal.userId
    if (!owned) return answerOf({ status: 403, body: { reason: 'server' }, origin })
    if (row.source !== 'cloud' && row.source !== 'repo')
      return answerOf({ status: 422, body: { reason: 'source' }, origin })

    let serverUrl: string | undefined
    try {
      serverUrl = serverUrlOf({ cipher: args.cipher, row })
    } catch {
      serverUrl = undefined
    }
    if (serverUrl === undefined)
      return answerOf({ status: 422, body: { reason: 'unsupported' }, origin })

    const begun = await args.gateway.begin({
      userId: principal.userId,
      ...(row.projectId === null ? {} : { projectId: row.projectId }),
      source: row.source,
      name: row.name,
      url: serverUrl,
      returnTarget: { surface: body.surface, screen: body.screen },
    })
    return begun.ok
      ? answerOf({ status: 200, body: { url: begun.url }, origin })
      : answerOf({ status: 422, body: { reason: begun.reason }, origin })
  }
}
