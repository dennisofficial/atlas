import {
  BookOpenTextIcon,
  BoxIcon,
  LayoutDashboardIcon,
  LockKeyholeIcon,
  PlugIcon,
  SparklesIcon,
  type LucideIcon,
} from 'lucide-react'

export enum EGroupSettingsSection {
  Overview = 'overview',
  Instructions = 'instructions',
  Sandbox = 'sandbox',
  Access = 'access',
  Skills = 'skills',
  Mcp = 'mcp',
}

export type GroupNavItem = {
  section: EGroupSettingsSection
  label: string
  icon: LucideIcon
}

export const GROUP_NAV: readonly GroupNavItem[] = [
  { section: EGroupSettingsSection.Overview, label: 'Overview', icon: LayoutDashboardIcon },
  { section: EGroupSettingsSection.Instructions, label: 'Instructions', icon: BookOpenTextIcon },
  { section: EGroupSettingsSection.Sandbox, label: 'Sandbox', icon: BoxIcon },
  { section: EGroupSettingsSection.Access, label: 'Access', icon: LockKeyholeIcon },
  { section: EGroupSettingsSection.Skills, label: 'Skills', icon: SparklesIcon },
  { section: EGroupSettingsSection.Mcp, label: 'MCP', icon: PlugIcon },
]

export function groupSectionOfPath(pathname: string): EGroupSettingsSection | null {
  const [, groups, , settings, section] = pathname.split('/')
  if (groups !== 'groups' || settings !== 'settings') return null
  return Object.values(EGroupSettingsSection).find((value) => value === section) ?? null
}

export function hrefOfGroupSection({
  groupId,
  section,
}: {
  groupId: string
  section: EGroupSettingsSection
}): string {
  return `/groups/${encodeURIComponent(groupId)}/settings/${section}`
}
