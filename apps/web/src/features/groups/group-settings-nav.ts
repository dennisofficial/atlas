import { BookOpenTextIcon, type LucideIcon } from 'lucide-react'

import {
  EProjectSettingsSection,
  PROJECT_NAV,
} from '@/features/project-settings/project-settings-nav'

export enum EGroupSettingsSection {
  Instructions = 'instructions',
}

const GROUP_NAV_SECTIONS = [
  EProjectSettingsSection.Overview,
  EGroupSettingsSection.Instructions,
  EProjectSettingsSection.Sandbox,
  EProjectSettingsSection.Access,
  EProjectSettingsSection.Skills,
  EProjectSettingsSection.Mcp,
] as const

export type GroupSection = (typeof GROUP_NAV_SECTIONS)[number]

export type GroupNavItem = {
  section: GroupSection
  label: string
  icon: LucideIcon
}

const NAV_BY_SECTION = new Map(PROJECT_NAV.map((item) => [item.section, item]))

const INSTRUCTIONS_NAV: GroupNavItem = {
  section: EGroupSettingsSection.Instructions,
  label: 'Instructions',
  icon: BookOpenTextIcon,
}

const navOf = (section: GroupSection): GroupNavItem => {
  if (section === EGroupSettingsSection.Instructions) return INSTRUCTIONS_NAV
  const item = NAV_BY_SECTION.get(section)
  if (item === undefined) throw new Error(`no project nav item for ${section}`)
  return { section, label: item.label, icon: item.icon }
}

export const GROUP_NAV: readonly GroupNavItem[] = GROUP_NAV_SECTIONS.map(navOf)

export const GROUP_SECTIONS: readonly GroupSection[] = GROUP_NAV_SECTIONS

const GROUP_SETTINGS_PATH = /^\/groups\/[^/]+\/settings\/([^/]+)/

export const groupSectionOfPath = (pathname: string): GroupSection | null => {
  const segment = GROUP_SETTINGS_PATH.exec(pathname)?.[1]
  return GROUP_SECTIONS.find((section) => section === segment) ?? null
}

export const hrefOfGroupSection = (args: { groupId: string; section: GroupSection }): string =>
  `/groups/${encodeURIComponent(args.groupId)}/settings/${args.section}`

export const GROUPS_HREF = '/settings/groups'
