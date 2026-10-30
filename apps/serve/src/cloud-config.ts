import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { ATLAS_MCP_FILE_NAME } from '@dltech/atlas-harness'
import {
  ENV_NAME_PATTERN,
  type ScopedFileMount,
  type ScopedMcpServer,
} from '@dltech/atlas-wire/web'

import { writeAtomically } from './owner-only-file'

const RESERVED_ENV_PREFIX = 'ATLAS_'

export type CloudSecret = { name: string; value: string }

export type CloudConfig = {
  settings: readonly { key: string; value: string }[]
  secrets: readonly CloudSecret[]
  harnessSecrets: readonly CloudSecret[]
  mcpServers: readonly ScopedMcpServer[]
  fileMounts: readonly ScopedFileMount[]
}

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
  exported?: Set<string> | undefined
}): number => {
  const previous = args.exported ?? new Set<string>()
  const current = new Set<string>()
  for (const secret of args.secrets) {
    if (!ENV_NAME_PATTERN.test(secret.name) || secret.name.startsWith(RESERVED_ENV_PREFIX)) continue
    if (args.env[secret.name] !== undefined && !previous.has(secret.name)) continue
    args.env[secret.name] = secret.value
    current.add(secret.name)
  }
  for (const name of previous) if (!current.has(name)) delete args.env[name]
  previous.clear()
  for (const name of current) previous.add(name)
  return current.size
}
