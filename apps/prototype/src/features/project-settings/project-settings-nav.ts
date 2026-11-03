import {
  BoxIcon,
  FileKeyIcon,
  GitPullRequestIcon,
  LayoutDashboardIcon,
  PlugIcon,
  SparklesIcon,
  VariableIcon,
  type LucideIcon,
} from 'lucide-react'

export enum EProjectSettingsSection {
  Overview = 'overview',
  Sandbox = 'sandbox',
  Secrets = 'secrets',
  Files = 'files',
  Mcp = 'mcp',
  Skills = 'skills',
  PullRequests = 'pull-requests',
}

export type ProjectNavItem = {
  section: EProjectSettingsSection
  label: string
  icon: LucideIcon
}

export const PROJECT_NAV: readonly ProjectNavItem[] = [
  {
    section: EProjectSettingsSection.Overview,
    label: 'Overview',
    icon: LayoutDashboardIcon,
  },
  { section: EProjectSettingsSection.Sandbox, label: 'Sandbox', icon: BoxIcon },
  {
    section: EProjectSettingsSection.Secrets,
    label: 'Secrets & Env Vars',
    icon: VariableIcon,
  },
  { section: EProjectSettingsSection.Files, label: 'Files', icon: FileKeyIcon },
  { section: EProjectSettingsSection.Mcp, label: 'MCP', icon: PlugIcon },
  { section: EProjectSettingsSection.Skills, label: 'Skills', icon: SparklesIcon },
  {
    section: EProjectSettingsSection.PullRequests,
    label: 'Pull requests',
    icon: GitPullRequestIcon,
  },
]

export function projectSectionOfPath(pathname: string): EProjectSettingsSection | null {
  const segments = pathname.split('/')
  const [, projects, , settings, section] = segments
  if (projects !== 'projects' || settings !== 'settings') return null
  if (section === EProjectSettingsSection.Skills) return EProjectSettingsSection.Skills
  return Object.values(EProjectSettingsSection).find((value) => value === section) ?? null
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
