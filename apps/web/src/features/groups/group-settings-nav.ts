import {
  EProjectSettingsSection,
  PROJECT_NAV,
  type ProjectNavItem,
} from '@/features/project-settings/project-settings-nav'

export const GROUP_SECTIONS = [
  EProjectSettingsSection.Overview,
  EProjectSettingsSection.Sandbox,
  EProjectSettingsSection.Access,
  EProjectSettingsSection.Skills,
  EProjectSettingsSection.Mcp,
] as const

export type GroupSection = (typeof GROUP_SECTIONS)[number]

export type GroupNavItem = ProjectNavItem & { section: GroupSection }

export const GROUP_NAV: readonly GroupNavItem[] = PROJECT_NAV.filter((item): item is GroupNavItem =>
  GROUP_SECTIONS.some((section) => section === item.section),
)

const GROUP_SETTINGS_PATH = /^\/groups\/[^/]+\/settings\/([^/]+)/

export const groupSectionOfPath = (pathname: string): GroupSection | null => {
  const segment = GROUP_SETTINGS_PATH.exec(pathname)?.[1]
  return GROUP_SECTIONS.find((section) => section === segment) ?? null
}

export const hrefOfGroupSection = (args: { groupId: string; section: GroupSection }): string =>
  `/groups/${encodeURIComponent(args.groupId)}/settings/${args.section}`

export const GROUPS_HREF = '/settings/groups'
