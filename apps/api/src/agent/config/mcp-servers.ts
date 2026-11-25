import { EDefinitionOrigin } from '@dltech/atlas-core'
import { createDb, createPool, type Db } from '@dltech/atlas-db'
import {
  EMcpRejection,
  mcpSpecSchema,
  type McpCloudRow,
  type McpRejection,
} from '@dltech/atlas-plugin-mcp/core'
import type { McpCloudRead, McpConfigPort } from '@dltech/atlas-plugin-mcp/pod'
import { z } from 'zod'

import { sameServerUrl } from '../mcp-oauth/seal'
import { databaseUrlWithTls } from './database-url'
import { readAgentHostEnv } from './env'
import { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'

const QUERY_TIMEOUT_MS = 10_000

const DEFINED_IN = 'the cloud'

const originOf = (scope: McpCloudRow['source']): EDefinitionOrigin => {
  if (scope === 'user') return EDefinitionOrigin.User
  if (scope === 'group') return EDefinitionOrigin.Group
  return EDefinitionOrigin.Project
}

const rejectionOf = (args: {
  rejection: EMcpRejection
  name: string
  scope: McpCloudRow['source']
  detail: string
}): McpRejection => ({
  rejection: args.rejection,
  name: args.name,
  definedIn: DEFINED_IN,
  origin: originOf(args.scope),
  detail: args.detail,
})

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const grantSchema = z.object({
  tokens: z.object({
    accessToken: z.string(),
    expiresAt: z.string().optional(),
  }),
})

type ScopeRow = {
  name: string
  sealedSpec: string | null
  oauthStatus: string | null
  oauthServerUrl: string | null
  oauthSealed: string | null
}

const unsealed = (args: { cipher: SecretCipher; sealed: string }): unknown => {
  try {
    return JSON.parse(args.cipher.decrypt(args.sealed))
  } catch {
    return undefined
  }
}

const accessTokenOf = (args: {
  cipher: SecretCipher
  row: ScopeRow
  spec: unknown
}): string | undefined => {
  if (args.row.oauthStatus !== 'active') return undefined
  const { oauthSealed, oauthServerUrl } = args.row
  if (oauthSealed === null || oauthServerUrl === null) return undefined
  const parsed = mcpSpecSchema.safeParse(args.spec)
  const transport = parsed.success ? parsed.data.transport : undefined
  if (transport?.kind !== 'http' || !sameServerUrl(transport.url, oauthServerUrl)) return undefined

  const grant = grantSchema.safeParse(unsealed({ cipher: args.cipher, sealed: oauthSealed }))
  if (!grant.success) return undefined
  const { accessToken, expiresAt } = grant.data.tokens
  if (expiresAt !== undefined && Date.parse(expiresAt) <= Date.now()) return undefined
  return accessToken
}

const readScope = (args: {
  cipher: SecretCipher
  scope: McpCloudRow['source']
  rows: readonly ScopeRow[]
}): McpCloudRead => {
  const rows: McpCloudRow[] = []
  const rejections: McpRejection[] = []
  for (const row of args.rows) {
    if (row.sealedSpec === null) {
      rejections.push(
        rejectionOf({
          rejection: EMcpRejection.Unreadable,
          name: row.name,
          scope: args.scope,
          detail: 'the cloud row holds no sealed spec',
        }),
      )
      continue
    }
    try {
      const spec: unknown = JSON.parse(args.cipher.decrypt(row.sealedSpec))
      const accessToken = accessTokenOf({ cipher: args.cipher, row, spec })
      rows.push({
        source: args.scope,
        spec,
        ...(accessToken === undefined ? {} : { accessToken }),
      })
    } catch (error) {
      rejections.push(
        rejectionOf({
          rejection: EMcpRejection.Unreadable,
          name: row.name,
          scope: args.scope,
          detail: messageOf(error),
        }),
      )
    }
  }
  return { rows, rejections }
}

export class McpServerReader {
  constructor(private readonly args: { db: Db; cipher: SecretCipher }) {}

  private async groupIdOf(projectId: string | null): Promise<string | null> {
    if (projectId === null) return null
    const project = await this.args.db.orm.public.Project.first({ id: projectId })
    return project?.groupId ?? null
  }

  async read({ sessionId }: { sessionId: string }): Promise<McpCloudRead> {
    const session = await this.args.db.orm.public.Session.first({ id: sessionId })
    if (session === null) return { rows: [], rejections: [] }
    const groupId = await this.groupIdOf(session.projectId)
    const servers = this.args.db.orm.public.McpServer
    const [user, group, project] = await Promise.all([
      servers.where({ userId: session.userId, source: 'cloud' }).all(),
      groupId === null ? Promise.resolve([]) : servers.where({ groupId, source: 'cloud' }).all(),
      servers.where({ projectId: session.projectId, source: 'cloud' }).all(),
    ])
    const reads = [
      readScope({ cipher: this.args.cipher, scope: 'user', rows: user }),
      readScope({ cipher: this.args.cipher, scope: 'group', rows: group }),
      readScope({ cipher: this.args.cipher, scope: 'project', rows: project }),
    ]
    return {
      rows: reads.flatMap((read) => read.rows),
      rejections: reads.flatMap((read) => read.rejections),
    }
  }
}

const readerOfEnv = (): McpServerReader => {
  const env = readAgentHostEnv()
  const pool = createPool(databaseUrlWithTls(env.databaseUrl), {
    queryTimeoutMs: QUERY_TIMEOUT_MS,
  })
  return new McpServerReader({
    db: createDb(pool),
    cipher: new SecretCipher(env.secretsEncryptionKey),
  })
}

export const mcpServerPort = (): McpConfigPort => {
  let reader: McpServerReader | undefined
  return {
    read: async (session) => {
      reader ??= readerOfEnv()
      return await reader.read(session)
    },
  }
}
