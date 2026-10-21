'use client'

import { useCallback } from 'react'

import {
  listSecrets,
  projectBase,
  workspaceBase,
  type ListedSecret,
} from '@/features/settings/data/workspace/resource-api'
import { useSecretsResource } from '@/features/settings/data/workspace/use-secrets-resource'
import { useWorkspaceAccess } from '@/features/settings/data/workspace/use-workspace-access'
import { EQueryState, useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'

import { inheritedViewOf } from './inherited-secrets'

export type InheritedSecrets = { secrets: ListedSecret[]; workspaceName: string | null }

export function useProjectSecrets(projectId: string) {
  const own = useSecretsResource(projectBase(projectId))
  const access = useWorkspaceAccess()
  const organizationId =
    access.state === EQueryState.Ready ? (access.data?.organization.id ?? null) : null
  const load = useCallback(async (): Promise<ListedSecret[]> => {
    if (organizationId === null) return []
    return listSecrets(workspaceBase(organizationId))
  }, [organizationId])
  const inherited: CloudQuery<ListedSecret[]> = useCloudQuery({
    key: `inherited:${organizationId ?? 'none'}:${access.state}`,
    load,
  })
  return { own, inherited: inheritedViewOf({ access, inherited }) }
}
