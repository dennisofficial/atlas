import type { LoadedMcpEntry } from '../core'
import { hashOf, type McpConfiguredServer, type McpConfiguredTransport } from './snapshot'

const secretValuesOf = (entry: LoadedMcpEntry): readonly string[] => {
  const transport = entry.transport
  const env = transport?.kind === 'stdio' ? Object.values(transport.env ?? {}) : []
  const headers = transport?.kind === 'http' ? Object.values(transport.headers ?? {}) : []
  const token = entry.accessToken === undefined ? [] : [entry.accessToken]
  return [...token, ...env, ...headers].sort()
}

export const configuredTransportOf = (entry: LoadedMcpEntry): McpConfiguredTransport | null => {
  const transport = entry.transport
  if (transport === undefined) return null
  if (transport.kind === 'http') return { kind: 'http', url: transport.url }
  return {
    kind: 'stdio',
    command: transport.command,
    ...(transport.args === undefined ? {} : { args: transport.args }),
  }
}

export const configHashOf = (entry: LoadedMcpEntry): string =>
  hashOf(
    JSON.stringify([
      configuredTransportOf(entry),
      entry.disabled === true,
      entry.proxy === true,
      secretValuesOf(entry),
    ]),
  )

export const specHashOf = (entry: LoadedMcpEntry): string =>
  hashOf(
    JSON.stringify([configuredTransportOf(entry), secretValuesOf(entry), entry.proxy === true]),
  )

export const configuredServerOf = (entry: LoadedMcpEntry): McpConfiguredServer => ({
  name: entry.name,
  origin: entry.origin,
  source: entry.source,
  definedIn: entry.definedIn,
  transport: configuredTransportOf(entry),
  proxy: entry.proxy === true,
  configHash: configHashOf(entry),
})
