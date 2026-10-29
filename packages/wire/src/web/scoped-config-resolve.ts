import type { ResolvedSandboxConfig, ScopedMcpServer, ScopedSecret } from './scoped-config-wire'
import {
  CONFIG_SCOPE_PRECEDENCE,
  EConfigScope,
  EProvenanceKind,
  isProvisioningOnlyName,
  provenanceKeyOf,
} from './scoped-config-wire'

export type ScopeLayer = {
  settings: Readonly<Record<string, string>>
  secrets: readonly ScopedSecret[]
  mcpServers: readonly ScopedMcpServer[]
}

export const EMPTY_SCOPE_LAYER: ScopeLayer = { settings: {}, secrets: [], mcpServers: [] }

export type ScopedConfigLayers = {
  defaults: ScopeLayer
  user: ScopeLayer
  project: ScopeLayer | null
}

const layerAt = (args: { layers: ScopedConfigLayers; scope: EConfigScope }): ScopeLayer | null => {
  switch (args.scope) {
    case EConfigScope.Default:
      return args.layers.defaults
    case EConfigScope.User:
      return args.layers.user
    case EConfigScope.Project:
      return args.layers.project
  }
}

const byName = <TEntry extends { name: string }>(entries: Map<string, TEntry>): TEntry[] =>
  [...entries.values()].sort((left, right) => left.name.localeCompare(right.name))

export const resolveScopedConfig = (layers: ScopedConfigLayers): ResolvedSandboxConfig => {
  const settings: Record<string, string> = {}
  const secrets = new Map<string, ScopedSecret>()
  const mcpServers = new Map<string, ScopedMcpServer>()
  const provenance: Record<string, EConfigScope> = {}

  for (const scope of CONFIG_SCOPE_PRECEDENCE) {
    const layer = layerAt({ layers, scope })
    if (layer === null) continue
    for (const [key, value] of Object.entries(layer.settings)) {
      settings[key] = value
      provenance[provenanceKeyOf({ kind: EProvenanceKind.Setting, name: key })] = scope
    }
    for (const secret of layer.secrets) {
      secrets.set(secret.name, secret)
      provenance[provenanceKeyOf({ kind: EProvenanceKind.Secret, name: secret.name })] = scope
    }
    for (const server of layer.mcpServers) {
      mcpServers.set(server.name, server)
      provenance[provenanceKeyOf({ kind: EProvenanceKind.McpServer, name: server.name })] = scope
    }
  }

  return { settings, secrets: byName(secrets), mcpServers: byName(mcpServers), provenance }
}

const isPodFacingProvenance = (key: string): boolean => {
  const separator = key.indexOf(':')
  const kind = key.slice(0, separator)
  if (kind === EProvenanceKind.McpServer) return true
  return !isProvisioningOnlyName(key.slice(separator + 1))
}

export const podFacingConfig = (resolved: ResolvedSandboxConfig): ResolvedSandboxConfig => ({
  settings: Object.fromEntries(
    Object.entries(resolved.settings).filter(([key]) => !isProvisioningOnlyName(key)),
  ),
  secrets: resolved.secrets.filter((secret) => !isProvisioningOnlyName(secret.name)),
  mcpServers: resolved.mcpServers,
  provenance: Object.fromEntries(
    Object.entries(resolved.provenance).filter(([key]) => isPodFacingProvenance(key)),
  ),
})
