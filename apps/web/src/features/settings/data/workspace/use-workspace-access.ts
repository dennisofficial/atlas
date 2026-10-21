'use client'

import { useCallback } from 'react'
import { z } from 'zod'

import { cloudJson, EHttpMethod } from '@/lib/cloud-api'
import {
  activeOrganizationId,
  listOrganizations,
  setActiveOrganization,
  type Organization,
} from '@/lib/organization-api'
import { useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'
import type { EWorkspaceRole } from '@/features/settings/fixtures/settings-workspace'

import { canManageWorkspace, parseMemberRole } from './workspace-role'

const activeMemberSchema = z
  .object({ id: z.string(), userId: z.string(), role: z.string() })
  .nullable()

export type WorkspaceAccess = {
  organization: Organization
  role: EWorkspaceRole | null
  userId: string
  canEdit: boolean
}

async function loadWorkspaceAccess(): Promise<WorkspaceAccess | null> {
  const [organizations, activeId] = await Promise.all([listOrganizations(), activeOrganizationId()])
  const organization = organizations.find((entry) => entry.id === activeId) ?? organizations[0]
  if (organization === undefined) return null
  if (organization.id !== activeId) await setActiveOrganization({ organizationId: organization.id })
  const member = await cloudJson({
    method: EHttpMethod.Get,
    path: '/api/auth/organization/get-active-member',
    schema: activeMemberSchema,
  })
  const role = member === null ? null : parseMemberRole(member.role)
  return { organization, role, userId: member?.userId ?? '', canEdit: canManageWorkspace(role) }
}

export function useWorkspaceAccess(): CloudQuery<WorkspaceAccess | null> {
  const load = useCallback(() => loadWorkspaceAccess(), [])
  return useCloudQuery({ key: 'workspace-access', load })
}
