import { EMcpOauthGrantStatus, EMcpServerSource, type McpOauthServer } from '@dltech/atlas-wire'
import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { openMcpServer } from '../mcp-servers/mcp-sealed'
import { normalizeServerUrl } from './mcp-oauth-seal'
import { EGrantRowStatus } from './mcp-oauth.types'
import type { ServerGrantRow } from './mcp-oauth.types'

export const serverUrlOf = (args: {
  cipher: SecretCipherService
  row: ServerGrantRow
}): string | undefined => {
  const { row } = args
  if (row.source === EMcpServerSource.Repo) {
    return row.repoUrl === null ? undefined : normalizeServerUrl(row.repoUrl)
  }
  if (row.sealedSpec === null) return undefined
  const opened = openMcpServer({
    cipher: args.cipher,
    sealedSpec: row.sealedSpec,
    updatedAt: new Date(0),
  })
  const transport = opened.transport
  if (transport === undefined || transport.kind !== 'http') return undefined
  if (Object.keys(transport.headers ?? {}).some((name) => name.toLowerCase() === 'authorization')) {
    return undefined
  }
  return normalizeServerUrl(transport.url)
}

export const toWireMcpOauthServer = (args: {
  cipher: SecretCipherService
  row: ServerGrantRow
}): McpOauthServer => {
  const { row } = args
  const status =
    row.oauthSealed === null
      ? EMcpOauthGrantStatus.None
      : row.oauthStatus === EGrantRowStatus.Active
        ? EMcpOauthGrantStatus.Connected
        : EMcpOauthGrantStatus.Expired
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    url: serverUrlOf(args) ?? '',
    status,
    ...(row.oauthUpdatedAt === null ? {} : { signedInAt: row.oauthUpdatedAt.toISOString() }),
    ...(row.lastSeenAt === null ? {} : { lastSeenAt: row.lastSeenAt.toISOString() }),
  }
}
