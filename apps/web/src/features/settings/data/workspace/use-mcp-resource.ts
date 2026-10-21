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

export function useMcpResource(base: string): McpResource {
  const load = useCallback(() => listMcpServers(base), [base])
  const query = useCloudQuery({ key: `mcp:${base}`, load })
  const { reload } = query
  const put = useCallback(
    async (args: { name: string; spec: McpUpsertWire }) => {
      await putMcpServer({ base, ...args })
      reload()
    },
    [base, reload],
  )
  const remove = useCallback(
    async (name: string) => {
      await deleteMcpServer({ base, name })
      reload()
    },
    [base, reload],
  )
  return { query, put, remove }
}
