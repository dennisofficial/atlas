import {
  EGroupSettingsSection,
  EProjectSettingsSection,
  GROUP_SECTIONS as SHARED_GROUP_SECTIONS,
  type TGroupSection,
} from '@dltech/atlas-client/settings'
import {
  BookOpenTextIcon,
  BoxIcon,
  LayoutDashboardIcon,
  LockKeyholeIcon,
  PlugIcon,
  SparklesIcon,
  type LucideIcon,
} from 'lucide-react'

export { EGroupSettingsSection, type TGroupSection as GroupSection }

export type GroupNavItem = {
  section: TGroupSection
  label: string
  icon: LucideIcon
}

const ICONS: Record<TGroupSection, LucideIcon> = {
  [EProjectSettingsSection.Overview]: LayoutDashboardIcon,
  [EGroupSettingsSection.Instructions]: BookOpenTextIcon,
  [EProjectSettingsSection.Sandbox]: BoxIcon,
  [EProjectSettingsSection.Access]: LockKeyholeIcon,
  [EProjectSettingsSection.Skills]: SparklesIcon,
  [EProjectSettingsSection.Mcp]: PlugIcon,
}

export const GROUP_NAV: readonly GroupNavItem[] = SHARED_GROUP_SECTIONS.map((item) => ({
  ...item,
  icon: ICONS[item.section],
}))

export const GROUP_SECTIONS: readonly TGroupSection[] = SHARED_GROUP_SECTIONS.map(
  (item) => item.section,
)

const GROUP_SETTINGS_PATH = /^\/groups\/[^/]+\/settings\/([^/]+)/

export const groupSectionOfPath = (pathname: string): TGroupSection | null => {
  const segment = GROUP_SETTINGS_PATH.exec(pathname)?.[1]
  return GROUP_SECTIONS.find((section) => section === segment) ?? null
}

export const hrefOfGroupSection = (args: { groupId: string; section: TGroupSection }): string =>
  `/groups/${encodeURIComponent(args.groupId)}/settings/${args.section}`

export const GROUPS_HREF = '/settings/groups'
