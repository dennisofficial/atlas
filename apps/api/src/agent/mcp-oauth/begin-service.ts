import type { Db } from '@dltech/atlas-db'
import { EReturnSurface, returnSurfaceOf, startLinkFor } from '@dltech/atlas-core'
import { z } from 'zod'

import type { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import { serverUrlOf } from './server-url'
import { McpOauthStore } from './store'
import { mcpReturnScreenSchema, mcpReturnSurfaceSchema, type McpOauthGateway } from './types'

export const MCP_OAUTH_BEGIN_PATH = '/mcp-oauth/begin'

export const mcpOauthBeginRequestSchema = z.strictObject({
  serverId: z.string().min(1),
  surface: mcpReturnSurfaceSchema,
  screen: mcpReturnScreenSchema,
})

export type McpOauthBeginRequest = z.infer<typeof mcpOauthBeginRequestSchema>

const surfaceOfBody = (surface: string): EReturnSurface =>
  returnSurfaceOf(surface) ?? EReturnSurface.Web

export type McpOauthBeginAnswer = { status: number; body: unknown }

export type McpOauthBeginServiceArgs = {
  db: Db
  cipher: SecretCipher
  gateway: McpOauthGateway
}

export class McpOauthBeginService {
  private readonly store: McpOauthStore
  private readonly args: McpOauthBeginServiceArgs

  constructor(args: McpOauthBeginServiceArgs) {
    this.args = args
    this.store = new McpOauthStore(args.db)
  }

  async begin(input: { userId: string; body: McpOauthBeginRequest }): Promise<McpOauthBeginAnswer> {
    const store = this.store
    const body = input.body
    const refused = (status: number, reason: string): McpOauthBeginAnswer => ({
      status,
      body: { reason },
    })

    if (body.screen.kind === 'settings' && body.screen.scope === 'project') {
      const owner = await store.projectOwner({ projectId: body.screen.id })
      if (owner !== input.userId) return refused(403, 'project')
    }
    if (body.screen.kind === 'settings' && body.screen.scope === 'group') {
      const owner = await store.groupOwner({ groupId: body.screen.id })
      if (owner !== input.userId) return refused(403, 'group')
    }

    const row = await store.find({ id: body.serverId })
    if (row === null) return refused(404, 'server')
    if (!(await store.ownsRow({ row, userId: input.userId }))) return refused(403, 'server')
    if (row.source !== 'cloud' && row.source !== 'repo') return refused(422, 'source')

    let serverUrl: string | undefined
    try {
      serverUrl = serverUrlOf({ cipher: this.args.cipher, row })
    } catch {
      serverUrl = undefined
    }
    if (serverUrl === undefined) return refused(422, 'unsupported')

    const begun = await this.args.gateway.begin({
      userId: input.userId,
      ...(row.projectId === null ? {} : { projectId: row.projectId }),
      ...(row.groupId === null ? {} : { groupId: row.groupId }),
      source: row.source,
      name: row.name,
      url: serverUrl,
      returnTarget: { surface: body.surface, screen: body.screen },
    })
    return begun.ok
      ? {
          status: 200,
          body: {
            url: startLinkFor({ url: begun.startUrl, surface: surfaceOfBody(body.surface) }),
          },
        }
      : refused(422, begun.reason)
  }
}
