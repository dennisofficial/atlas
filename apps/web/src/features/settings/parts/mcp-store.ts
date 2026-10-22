'use client'

import { useState } from 'react'

import type { McpServer } from '../fixtures/settings-mcp'

export type McpDraft = McpServer & { extra: string }

export type McpStore = {
  servers: McpServer[]
  add: (draft: McpDraft) => Promise<void>
  toggle: (args: { id: string; enabled: boolean }) => Promise<void>
  remove: (id: string) => Promise<void>
}

export function useLocalMcpStore(initial: McpServer[]): McpStore {
  const [servers, setServers] = useState(initial)
  return {
    servers,
    add: async (draft) =>
      setServers((current) => [
        ...current,
        {
          id: draft.id,
          transport: draft.transport,
          target: draft.target,
          enabled: draft.enabled,
        },
      ]),
    toggle: async ({ id, enabled }) =>
      setServers((current) =>
        current.map((server) => (server.id === id ? { ...server, enabled } : server)),
      ),
    remove: async (id) => setServers((current) => current.filter((server) => server.id !== id)),
  }
}
