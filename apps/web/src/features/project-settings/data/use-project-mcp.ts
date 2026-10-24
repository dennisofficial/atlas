'use client'

import { useMemo } from 'react'

import { EMcpTransportKind, type McpServerWire } from '@dltech/atlas-wire/web'

import {
  rowOfServer,
  upsertOfDraft,
  upsertOfToggle,
  type McpRow,
} from '@/features/settings/data/workspace/mcp-mapping'
import { projectOwner } from '@/features/settings/data/workspace/resource-api'
import { useMcpResource } from '@/features/settings/data/workspace/use-mcp-resource'
import { EQueryState, type CloudQuery } from '@/lib/use-cloud-query'

import { EMcpTransport } from '../fixtures/project-settings'

export const transportOfKind = (kind: EMcpTransportKind): EMcpTransport =>
  kind === EMcpTransportKind.Http ? EMcpTransport.Http : EMcpTransport.Stdio

export const kindOfTransport = (transport: EMcpTransport): EMcpTransportKind =>
  transport === EMcpTransport.Http ? EMcpTransportKind.Http : EMcpTransportKind.Stdio

export type ProjectMcp = {
  query: CloudQuery<McpRow[]>
  add: (args: {
    id: string
    transport: EMcpTransport
    target: string
    extra: string
  }) => Promise<void>
  toggle: (args: { id: string; enabled: boolean }) => Promise<void>
  remove: (id: string) => Promise<void>
}

export function useProjectMcp(projectId: string): ProjectMcp {
  const { query: raw, put, remove } = useMcpResource(projectOwner(projectId))
  const servers: McpServerWire[] = raw.state === EQueryState.Ready ? raw.data : []
  const query = useMemo<CloudQuery<McpRow[]>>(
    () => (raw.state === EQueryState.Ready ? { ...raw, data: raw.data.map(rowOfServer) } : raw),
    [raw],
  )
  return {
    query,
    add: ({ id, transport, target, extra }) =>
      put({ name: id, spec: upsertOfDraft({ kind: kindOfTransport(transport), target, extra }) }),
    toggle: async ({ id, enabled }) => {
      const server = servers.find((entry) => entry.name === id)
      if (server === undefined) throw new Error(`${id} no longer exists`)
      await put({ name: id, spec: upsertOfToggle({ server, enabled }) })
    },
    remove,
  }
}
