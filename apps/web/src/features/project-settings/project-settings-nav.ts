import {
  BoxIcon,
  GitPullRequestIcon,
  LayoutDashboardIcon,
  LockKeyholeIcon,
  PlugIcon,
  SparklesIcon,
  type LucideIcon,
} from 'lucide-react'

export enum EProjectSettingsSection {
  Overview = 'overview',
  Sandbox = 'sandbox',
  Access = 'access',
  Skills = 'skills',
  Mcp = 'mcp',
  PullRequests = 'pull-requests',
}

export type ProjectNavItem = {
  section: EProjectSettingsSection
  label: string
  icon: LucideIcon
}

export const PROJECT_NAV: readonly ProjectNavItem[] = [
  { section: EProjectSettingsSection.Overview, label: 'Overview', icon: LayoutDashboardIcon },
  { section: EProjectSettingsSection.Sandbox, label: 'Sandbox', icon: BoxIcon },
  { section: EProjectSettingsSection.Access, label: 'Access', icon: LockKeyholeIcon },
  { section: EProjectSettingsSection.Skills, label: 'Skills', icon: SparklesIcon },
  { section: EProjectSettingsSection.Mcp, label: 'MCP', icon: PlugIcon },
  {
    section: EProjectSettingsSection.PullRequests,
    label: 'Pull requests',
    icon: GitPullRequestIcon,
  },
]

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
