'use client'

import { useCallback } from 'react'

import type { McpServerWire, McpUpsertWire } from '@dltech/atlas-wire/web'

import { useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'

import {
  deleteMcpServer,
  listMcpServers,
  ownerKeyOf,
  putMcpServer,
  type ResourceOwner,
} from './resource-api'

export type McpResource = {
  query: CloudQuery<McpServerWire[]>
  put: (args: { name: string; spec: McpUpsertWire }) => Promise<void>
  remove: (name: string) => Promise<void>
}

export function useMcpResource(owner: ResourceOwner): McpResource {
  const ownerKey = ownerKeyOf(owner)
  const load = useCallback(() => listMcpServers(owner), [ownerKey])
  const query = useCloudQuery({ key: `mcp:${ownerKey}`, load })
  const { reload } = query
  const put = useCallback(
    async (args: { name: string; spec: McpUpsertWire }) => {
      await putMcpServer({ owner, ...args })
      reload()
    },
    [ownerKey, reload],
  )
  const remove = useCallback(
    async (name: string) => {
      await deleteMcpServer({ owner, name })
      reload()
    },
    [ownerKey, reload],
  )
  return { query, put, remove }
}
