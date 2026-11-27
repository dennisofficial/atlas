import { EProjectSettingsSection, PROJECT_SECTIONS } from '@dltech/atlas-client/settings'
import {
  BoxIcon,
  GitPullRequestIcon,
  LayoutDashboardIcon,
  LockKeyholeIcon,
  PlugIcon,
  SparklesIcon,
  type LucideIcon,
} from 'lucide-react'

export { EProjectSettingsSection }

export type ProjectNavItem = {
  section: EProjectSettingsSection
  label: string
  icon: LucideIcon
}

const ICONS: Record<EProjectSettingsSection, LucideIcon> = {
  [EProjectSettingsSection.Overview]: LayoutDashboardIcon,
  [EProjectSettingsSection.Sandbox]: BoxIcon,
  [EProjectSettingsSection.Access]: LockKeyholeIcon,
  [EProjectSettingsSection.Skills]: SparklesIcon,
  [EProjectSettingsSection.Mcp]: PlugIcon,
  [EProjectSettingsSection.PullRequests]: GitPullRequestIcon,
}

export const PROJECT_NAV: readonly ProjectNavItem[] = PROJECT_SECTIONS.map((item) => ({
  ...item,
  icon: ICONS[item.section],
}))

const PROJECT_SETTINGS_PATH = /^\/projects\/[^/]+\/settings\/([^/]+)/

export function projectSectionOfPath(pathname: string): EProjectSettingsSection | null {
  const segment = PROJECT_SETTINGS_PATH.exec(pathname)?.[1]
  return Object.values(EProjectSettingsSection).find((section) => section === segment) ?? null
}

export function hrefOfProjectSection({
  projectId,
  section,
}: {
  projectId: string
  section: EProjectSettingsSection
}): string {
  return `/projects/${encodeURIComponent(projectId)}/settings/${section}`
}
