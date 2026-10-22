import { PERSONAL_WORKSPACE_VALUE } from '@/features/project-settings/data/project-mapping'
import type { Organization } from '@/lib/organization-api'

export const PRIVATE_OWNER_LABEL = 'Private'
const WORKSPACE_FALLBACK_LABEL = 'Workspace'
const INITIALS_LENGTH = 2

export interface OwnerOption {
  id: string
  title: string
  description: string
  initials: string
}

export const initialsOf = (name: string): string =>
  name.trim().slice(0, INITIALS_LENGTH).toUpperCase() || '?'

export function ownerOptionsOf(organizations: readonly Organization[]): OwnerOption[] {
  return [
    ...organizations.map((organization) => ({
      id: organization.id,
      title: organization.name,
      description: 'Workspace',
      initials: initialsOf(organization.name),
    })),
    {
      id: PERSONAL_WORKSPACE_VALUE,
      title: PRIVATE_OWNER_LABEL,
      description: 'Only you',
      initials: initialsOf(PRIVATE_OWNER_LABEL),
    },
  ]
}

export function ownerNameOf({
  organizationId,
  organizations,
}: {
  organizationId: string | null | undefined
  organizations: readonly Organization[]
}): string {
  if (!organizationId) return PRIVATE_OWNER_LABEL
  return (
    organizations.find((organization) => organization.id === organizationId)?.name ??
    WORKSPACE_FALLBACK_LABEL
  )
}
