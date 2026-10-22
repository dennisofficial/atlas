import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { ATLAS_MCP_FILE_NAME } from '@dltech/atlas-harness'
import { ENV_NAME_PATTERN, ESecretKind, type ScopedMcpServer } from '@dltech/atlas-wire/web'

import { writeAtomically } from './owner-only-file'

export const CLOUD_CONFIG_PATH = '/v1/sandboxes/self/config'

const RESERVED_ENV_PREFIX = 'ATLAS_'

export type CloudSecret = { name: string; value: string; kind: ESecretKind }

export type CloudConfig = {
  settings: readonly { key: string; value: string }[]
  secrets: readonly CloudSecret[]
  mcpServers: readonly ScopedMcpServer[]
}

export const cloudConfigPathFor = (projectId: string | null | undefined): string =>
  projectId ? `${CLOUD_CONFIG_PATH}?projectId=${encodeURIComponent(projectId)}` : CLOUD_CONFIG_PATH

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const existingServersAt = (file: string): Record<string, unknown> => {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
  if (!isRecord(parsed)) return {}
  const wrapped = parsed.mcpServers
  return isRecord(wrapped) ? { ...wrapped } : { ...parsed }
}

export const mergeCloudMcpServers = (args: {
  atlasHome: string
  servers: readonly ScopedMcpServer[]
}): void => {
  if (args.servers.length === 0) return
  const file = join(args.atlasHome, ATLAS_MCP_FILE_NAME)
  const servers = existingServersAt(file)
  for (const server of args.servers) servers[server.name] = server.spec
  writeAtomically({ path: file, content: `${JSON.stringify({ mcpServers: servers }, null, 2)}\n` })
}

export const exportEnvSecrets = (args: {
  env: Record<string, string | undefined>
  secrets: readonly CloudSecret[]
}): number => {
  let exported = 0
  for (const secret of args.secrets) {
    if (secret.kind !== ESecretKind.EnvVar) continue
    if (!ENV_NAME_PATTERN.test(secret.name) || secret.name.startsWith(RESERVED_ENV_PREFIX)) continue
    if (args.env[secret.name] !== undefined) continue
    args.env[secret.name] = secret.value
    exported += 1
  }
  return exported
}
