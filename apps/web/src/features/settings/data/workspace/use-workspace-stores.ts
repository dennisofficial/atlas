'use client'

import { useMemo } from 'react'
import { toast } from 'sonner'

import { EMcpTransportKind } from '@dltech/atlas-wire/web'

import { EMcpTransport, type McpServer } from '@/features/settings/fixtures/settings-mcp'
import type { LibrarySecret } from '@/features/settings/fixtures/settings-library'
import type { McpStore } from '@/features/settings/parts/mcp-store'
import type { SecretsStore } from '@/features/settings/parts/secrets-store'
import { EQueryState, type CloudQuery } from '@/lib/use-cloud-query'

import { rowOfServer, transportKindOf, upsertOfDraft, upsertOfToggle } from './mcp-mapping'
import { workspaceBase } from './resource-api'
import { librarySecretOf, wireKindOf } from './secrets-mapping'
import { useMcpResource } from './use-mcp-resource'
import { useSecretsResource } from './use-secrets-resource'
import { READ_ONLY_MESSAGE } from './workspace-role'

const guard = (canEdit: boolean) => {
  if (!canEdit) throw new Error(READ_ONLY_MESSAGE)
}

export function useWorkspaceSecretsStore(args: { organizationId: string; canEdit: boolean }): {
  query: CloudQuery<LibrarySecret[]>
  store: SecretsStore
} {
  const { query: raw, save, remove } = useSecretsResource(workspaceBase(args.organizationId))
  const { canEdit } = args
  const secrets = useMemo(
    () =>
      raw.state === EQueryState.Ready
        ? raw.data.secrets.map((secret) => librarySecretOf({ secret, now: raw.data.fetchedAt }))
        : [],
    [raw],
  )
  const store = useMemo<SecretsStore>(
    () => ({
      secrets,
      save: async (entry) => {
        guard(canEdit)
        const existing = secrets.find((secret) => secret.key === entry.key)
        const value = entry.value === '' ? (existing?.value ?? '') : entry.value
        if (value === '') throw new Error('A value is required')
        await save({ name: entry.key, value, kind: wireKindOf(entry.kind) })
        toast.success(`Saved ${entry.key}`)
      },
      remove: async (key) => {
        guard(canEdit)
        await remove(key)
        toast.success(`Deleted ${key}`)
      },
    }),
    [secrets, canEdit, save, remove],
  )
  const query = useMemo<CloudQuery<LibrarySecret[]>>(
    () => (raw.state === EQueryState.Ready ? { ...raw, data: secrets } : raw),
    [raw, secrets],
  )
  return { query, store }
}

const transportOfKind = (kind: EMcpTransportKind): EMcpTransport =>
  kind === EMcpTransportKind.Http ? EMcpTransport.Http : EMcpTransport.Stdio

export function useWorkspaceMcpStore(args: { organizationId: string; canEdit: boolean }): {
  ready: CloudQuery<unknown>
  store: McpStore
} {
  const { query, put, remove } = useMcpResource(workspaceBase(args.organizationId))
  const { canEdit } = args
  const raw = query.state === EQueryState.Ready ? query.data : null
  const servers = useMemo<McpServer[]>(
    () =>
      (raw ?? []).map((server) => {
        const row = rowOfServer(server)
        return {
          id: row.id,
          transport: transportOfKind(row.kind),
          target: row.target,
          enabled: row.enabled,
        }
      }),
    [raw],
  )
  const store = useMemo<McpStore>(
    () => ({
      servers,
      add: async (draft) => {
        guard(canEdit)
        const spec = upsertOfDraft({
          kind: transportKindOf(draft.transport),
          target: draft.target,
          extra: draft.extra,
        })
        await put({ name: draft.id, spec })
        toast.success(`Added ${draft.id}`)
      },
      toggle: async ({ id, enabled }) => {
        guard(canEdit)
        const server = raw?.find((entry) => entry.name === id)
        if (server === undefined) throw new Error(`${id} no longer exists`)
        await put({ name: id, spec: upsertOfToggle({ server, enabled }) })
      },
      remove: async (id) => {
        guard(canEdit)
        await remove(id)
        toast.success(`Removed ${id}`)
      },
    }),
    [servers, raw, canEdit, put, remove],
  )
  return { ready: query, store }
}
