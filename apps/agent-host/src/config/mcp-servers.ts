import { EDefinitionOrigin } from '@dltech/atlas-core'
import { createDb, createPool, type Db } from '@dltech/atlas-db'
import { EMcpRejection, type McpCloudRow, type McpRejection } from '@dltech/atlas-plugin-mcp/core'
import type { McpCloudRead, McpConfigPort } from '@dltech/atlas-plugin-mcp/pod'

import { databaseUrlWithTls } from './database-url'
import { readAgentHostEnv } from './env'
import { SecretCipher } from './secret-cipher'

const QUERY_TIMEOUT_MS = 10_000

const DEFINED_IN = 'the cloud'

const originOf = (scope: McpCloudRow['source']): EDefinitionOrigin =>
  scope === 'user' ? EDefinitionOrigin.User : EDefinitionOrigin.Project

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

const readScope = (args: {
  cipher: SecretCipher
  scope: McpCloudRow['source']
  rows: readonly { name: string; sealedSpec: string | null }[]
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
      rows.push({
        source: args.scope,
        spec: JSON.parse(args.cipher.decrypt(row.sealedSpec)),
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

  async read({ sessionId }: { sessionId: string }): Promise<McpCloudRead> {
    const session = await this.args.db.orm.v2.V2Session.first({ id: sessionId })
    if (session === null) return { rows: [], rejections: [] }
    const servers = this.args.db.orm.public.McpServer
    const [user, project] = await Promise.all([
      servers.where({ userId: session.userId, source: 'cloud' }).all(),
      servers.where({ projectId: session.projectId, source: 'cloud' }).all(),
    ])
    const userRead = readScope({ cipher: this.args.cipher, scope: 'user', rows: user })
    const projectRead = readScope({ cipher: this.args.cipher, scope: 'project', rows: project })
    return {
      rows: [...userRead.rows, ...projectRead.rows],
      rejections: [...userRead.rejections, ...projectRead.rejections],
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
