'use client'

import { useCallback, useMemo } from 'react'

import type { McpServerWire } from '@dltech/atlas-wire/web'

import type { McpDraft, McpStore } from '../../parts/mcp-store'
import { addMcpServer, deleteMcpServer, putMcpServer, toMcpServer } from './mcp-api'

export function useMcpStore(args: { servers: McpServerWire[]; reload: () => void }): McpStore {
  const { servers: wire, reload } = args
  const servers = useMemo(() => wire.map(toMcpServer), [wire])

  const add = useCallback(
    async (draft: McpDraft) => {
      await addMcpServer(draft)
      reload()
    },
    [reload],
  )
  const toggle = useCallback(
    async (change: { id: string; enabled: boolean }) => {
      const current = wire.find((server) => server.name === change.id)
      await putMcpServer({
        name: change.id,
        transport: current?.transport,
        disabled: !change.enabled,
      })
      reload()
    },
    [wire, reload],
  )
  const remove = useCallback(
    async (id: string) => {
      await deleteMcpServer(id)
      reload()
    },
    [reload],
  )
  return { servers, add, toggle, remove }
}
