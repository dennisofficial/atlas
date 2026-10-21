import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import type { UpsertMcpServerDto } from './mcp-servers.dto'
import { assertValidName, toMcpSpec } from './mcp-servers.service'
import type { McpServerDto } from './mcp-servers.types'

export const sealMcpSpec = (args: {
  cipher: SecretCipherService
  name: string
  spec: UpsertMcpServerDto
}): string => args.cipher.encrypt(JSON.stringify(toMcpSpec({ ...args.spec, name: args.name })))

export const openMcpServer = (args: {
  cipher: SecretCipherService
  sealedSpec: string
  updatedAt: Date
}): McpServerDto => {
  const stored = JSON.parse(args.cipher.decrypt(args.sealedSpec)) as UpsertMcpServerDto & {
    name: string
  }
  return { ...toMcpSpec(stored), updatedAt: args.updatedAt.toISOString() }
}

export { assertValidName as assertMcpServerName }
