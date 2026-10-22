'use client'

import { useCallback } from 'react'

import { activeOrganizationId, listOrganizations, type Organization } from './organization-api'
import { useCloudQuery, type CloudQuery } from './use-cloud-query'

async function loadActiveWorkspace(): Promise<Organization | null> {
  const [organizations, activeId] = await Promise.all([listOrganizations(), activeOrganizationId()])
  return (
    organizations.find((organization) => organization.id === activeId) ?? organizations[0] ?? null
  )
}

export function useActiveWorkspace(): CloudQuery<Organization | null> {
  const load = useCallback(() => loadActiveWorkspace(), [])
  return useCloudQuery({ key: 'active-workspace', load })
}
