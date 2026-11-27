'use client'

import { useCallback, useMemo } from 'react'

import { mcpServersInputOf } from '@dltech/atlas-client/settings'
import { type McpServerScope, type McpServerWire, type McpUpsertWire } from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'
import { useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'

export type McpResourceScope =
  | { readonly kind: 'project'; readonly projectId: string }
  | { readonly kind: 'group'; readonly groupId: string }

export type McpResource = {
  query: CloudQuery<McpServerWire[]>
  put: (args: { name: string; spec: McpUpsertWire }) => Promise<void>
  remove: (name: string) => Promise<void>
}

export const mcpScopeInputOf = (scope: McpResourceScope): McpServerScope =>
  mcpServersInputOf(
    scope.kind === 'project'
      ? { kind: 'project', id: scope.projectId }
      : { kind: 'group', id: scope.groupId },
  )

const scopeIdOf = (scope: McpResourceScope): string =>
  scope.kind === 'project' ? scope.projectId : scope.groupId

const mcpResourceKeyOf = (scope: McpResourceScope): string =>
  `mcp:${scope.kind}:${scopeIdOf(scope)}`

export function useMcpResource(scope: McpResourceScope): McpResource {
  const kind = scope.kind
  const id = scopeIdOf(scope)
  const input = useMemo(() => mcpScopeInputOf(scope), [kind, id])
  const load = useCallback(
    async () => (await cloudCall(api.mcpServers.list.query(input))).servers,
    [input],
  )
  const query = useCloudQuery({ key: mcpResourceKeyOf(scope), load })
  const { reload } = query
  const put = useCallback(
    async (args: { name: string; spec: McpUpsertWire }) => {
      await cloudCall(api.mcpServers.put.mutate({ ...input, name: args.name, ...args.spec }))
      reload()
    },
    [input, reload],
  )
  const remove = useCallback(
    async (name: string) => {
      await cloudCall(api.mcpServers.remove.mutate({ ...input, name }))
      reload()
    },
    [input, reload],
  )
  return { query, put, remove }
}
