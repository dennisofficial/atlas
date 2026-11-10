import { mcpSpecSchema } from '@dltech/atlas-plugin-mcp/core'

import type { SecretCipher } from '../config/secret-cipher'
import { normalizeServerUrl } from './seal'
import type { McpServerGrantRow } from './types'

const hasAuthorizationHeader = (headers: Record<string, string> | undefined): boolean =>
  Object.keys(headers ?? {}).some((name) => name.toLowerCase() === 'authorization')

export const serverUrlOf = (args: {
  cipher: SecretCipher
  row: McpServerGrantRow
}): string | undefined => {
  const { row } = args
  if (row.source === 'repo') {
    return row.repoUrl === null ? undefined : normalizeServerUrl(row.repoUrl)
  }
  if (row.sealedSpec === null) return undefined
  const parsed = mcpSpecSchema.safeParse(JSON.parse(args.cipher.decrypt(row.sealedSpec)))
  if (!parsed.success) return undefined
  const transport = parsed.data.transport
  if (transport?.kind !== 'http' || hasAuthorizationHeader(transport.headers)) return undefined
  return normalizeServerUrl(transport.url)
}
