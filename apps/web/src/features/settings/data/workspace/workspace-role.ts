import { EWorkspaceRole, parseRole } from '@/features/settings/fixtures/settings-workspace'

export const READ_ONLY_NOTE = 'Only owners and admins can change this.'
export const READ_ONLY_MESSAGE = 'Only owners and admins can change this'

const RANK: Record<EWorkspaceRole, number> = {
  [EWorkspaceRole.Owner]: 2,
  [EWorkspaceRole.Admin]: 1,
  [EWorkspaceRole.Member]: 0,
}

export function parseMemberRole(raw: string): EWorkspaceRole | null {
  const roles = raw
    .split(',')
    .map((entry) => parseRole(entry.trim()))
    .filter((role): role is EWorkspaceRole => role !== null)
  return roles.sort((left, right) => RANK[right] - RANK[left])[0] ?? null
}

export const canManageWorkspace = (role: EWorkspaceRole | null): boolean =>
  role === EWorkspaceRole.Owner || role === EWorkspaceRole.Admin

export const describeAccess = ({
  description,
  canEdit,
}: {
  description: string
  canEdit: boolean
}): string => (canEdit ? description : `${description} ${READ_ONLY_NOTE}`)
