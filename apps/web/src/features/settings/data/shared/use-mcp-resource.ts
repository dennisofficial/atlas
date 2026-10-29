'use client'

import { useCallback } from 'react'

import type { McpServerWire, McpUpsertWire } from '@dltech/atlas-wire/web'

import { useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'

import { deleteMcpServer, listMcpServers, putMcpServer } from './resource-api'

export type McpResource = {
  query: CloudQuery<McpServerWire[]>
  put: (args: { name: string; spec: McpUpsertWire }) => Promise<void>
  remove: (name: string) => Promise<void>
}

export function useMcpResource(projectId: string): McpResource {
  const load = useCallback(() => listMcpServers(projectId), [projectId])
  const query = useCloudQuery({ key: `mcp:${projectId}`, load })
  const { reload } = query
  const put = useCallback(
    async (args: { name: string; spec: McpUpsertWire }) => {
      await putMcpServer({ projectId, ...args })
      reload()
    },
    [projectId, reload],
  )
  const remove = useCallback(
    async (name: string) => {
      await deleteMcpServer({ projectId, name })
      reload()
    },
    [projectId, reload],
  )
  return { query, put, remove }
}
