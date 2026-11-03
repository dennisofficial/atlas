import { randomUUID } from 'node:crypto'
import { db, type Tx } from '@dltech/atlas-db'
import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { normalizeServerUrl } from '../mcp-oauth/mcp-oauth-seal'
import { openMcpServer } from './mcp-sealed'

const CLEARED_GRANT = {
  oauthServerUrl: null,
  oauthSealed: null,
  oauthStatus: null,
  oauthRefreshAttempt: null,
  oauthRefreshStartedAt: null,
  oauthUpdatedAt: null,
} as const

const grantClearingUpdate = (args: {
  cipher: SecretCipherService
  row: {
    oauthServerUrl: string | null
    oauthGeneration: number
    sealedSpec: string | null
  }
  newSealedSpec: string
}): ({ oauthGeneration: number } & typeof CLEARED_GRANT) | Record<string, never> => {
  if (args.row.oauthServerUrl === null || args.row.sealedSpec === null) return {}
  const spec = openMcpServer({
    cipher: args.cipher,
    sealedSpec: args.newSealedSpec,
    updatedAt: new Date(0),
  })
  const transport = spec.transport
  if (transport === undefined || transport.kind !== 'http') {
    return { ...CLEARED_GRANT, oauthGeneration: args.row.oauthGeneration + 1 }
  }
  if (normalizeServerUrl(transport.url) !== args.row.oauthServerUrl) {
    return { ...CLEARED_GRANT, oauthGeneration: args.row.oauthGeneration + 1 }
  }
  return {}
}

export const putCloudServer = async (args: {
  cipher: SecretCipherService
  scope: { userId: string } | { projectId: string }
  idPrefix: 'mcp_' | 'pmcp_'
  name: string
  sealedSpec: string
}): Promise<void> => {
  const conflictOn =
    'userId' in args.scope
      ? { userId: args.scope.userId, source: 'cloud' as const, name: args.name }
      : { projectId: args.scope.projectId, source: 'cloud' as const, name: args.name }
  await db.transaction(async (tx: Tx) => {
    const existing = await tx.orm.public.McpServer.first(conflictOn)
    if (existing === null) {
      await tx.orm.public.McpServer.create({
        id: `${args.idPrefix}${randomUUID()}`,
        ...args.scope,
        source: 'cloud',
        name: args.name,
        sealedSpec: args.sealedSpec,
      })
      return
    }
    await tx.orm.public.McpServer.where({ id: existing.id }).updateAndCount({
      sealedSpec: args.sealedSpec,
      ...grantClearingUpdate({
        cipher: args.cipher,
        row: existing,
        newSealedSpec: args.sealedSpec,
      }),
    })
  })
}
