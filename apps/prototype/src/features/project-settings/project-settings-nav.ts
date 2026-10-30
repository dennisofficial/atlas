import {
  BoxIcon,
  FileKeyIcon,
  LayoutDashboardIcon,
  PlugIcon,
  VariableIcon,
  type LucideIcon,
} from 'lucide-react'

export enum EProjectSettingsSection {
  Overview = 'overview',
  Sandbox = 'sandbox',
  Secrets = 'secrets',
  Files = 'files',
  Mcp = 'mcp',
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
]

export function projectSectionOfPath(pathname: string): EProjectSettingsSection | null {
  const [, projects, , settings, section] = pathname.split('/')
  if (projects !== 'projects' || settings !== 'settings') return null
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
