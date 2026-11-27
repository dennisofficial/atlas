import type { McpScope } from '@dltech/atlas-client/settings'

export type McpAddParams = { scope?: string; id?: string }

export const mcpScopeOfParams = (params: McpAddParams): McpScope => {
  if (params.scope === 'project' && params.id !== undefined)
    return { kind: 'project', id: params.id }
  if (params.scope === 'group' && params.id !== undefined) return { kind: 'group', id: params.id }
  return { kind: 'user' }
}

export const mcpAddParamsOf = (scope: McpScope): McpAddParams =>
  scope.kind === 'user' ? { scope: 'user' } : { scope: scope.kind, id: scope.id }
