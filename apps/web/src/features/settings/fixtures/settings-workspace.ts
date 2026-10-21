export enum EWorkspaceRole {
  Owner = 'owner',
  Admin = 'admin',
  Member = 'member',
}

export type SelectOption = { value: string; label: string }

export type WorkspaceMember = {
  id: string
  userId: string
  name: string
  email: string
  initials: string
  role: EWorkspaceRole
  joined: string
  lastActive: string
}

export type PendingInvite = {
  id: string
  email: string
  role: EWorkspaceRole
  invitedBy: string
  expiresInDays: number
}

export const ROLE_LABELS: Record<EWorkspaceRole, string> = {
  [EWorkspaceRole.Owner]: 'Owner',
  [EWorkspaceRole.Admin]: 'Admin',
  [EWorkspaceRole.Member]: 'Member',
}

export const ASSIGNABLE_ROLES: EWorkspaceRole[] = [EWorkspaceRole.Admin, EWorkspaceRole.Member]

export const ASSIGNABLE_ROLE_OPTIONS: SelectOption[] = ASSIGNABLE_ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}))

export function parseRole(value: string | null): EWorkspaceRole | null {
  return Object.values(EWorkspaceRole).find((role) => role === value) ?? null
}

export const REGION_OPTIONS: SelectOption[] = [
  { value: 'iad1', label: 'iad1 · Washington, D.C.' },
  { value: 'sfo1', label: 'sfo1 · San Francisco' },
  { value: 'fra1', label: 'fra1 · Frankfurt' },
]

export const NO_DEFAULT_MODEL = 'none'

export const DEFAULT_MODEL_OPTIONS: SelectOption[] = [
  { value: NO_DEFAULT_MODEL, label: 'No default' },
  { value: 'claude-sonnet', label: 'Claude Sonnet' },
  { value: 'claude-opus', label: 'Claude Opus' },
  { value: 'gpt-5', label: 'GPT-5' },
  { value: 'gpt-5-mini', label: 'GPT-5 mini' },
]
