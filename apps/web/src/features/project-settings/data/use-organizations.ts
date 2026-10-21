'use client'

import { listOrganizations, type Organization } from '@/lib/organization-api'
import { useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'

export function useOrganizations(): CloudQuery<Organization[]> {
  return useCloudQuery({ key: 'organizations', load: listOrganizations })
}
