import { BoxIcon, KeyRoundIcon, LayoutDashboardIcon, PlugIcon, type LucideIcon } from 'lucide-react'

export enum EProjectSettingsSection {
  Overview = 'overview',
  Sandbox = 'sandbox',
  Secrets = 'secrets',
  Mcp = 'mcp',
}

export type ProjectNavItem = {
  section: EProjectSettingsSection
  label: string
  icon: LucideIcon
}

export const PROJECT_NAV: readonly ProjectNavItem[] = [
  { section: EProjectSettingsSection.Overview, label: 'Overview', icon: LayoutDashboardIcon },
  { section: EProjectSettingsSection.Sandbox, label: 'Sandbox', icon: BoxIcon },
  { section: EProjectSettingsSection.Secrets, label: 'Secrets & Env Vars', icon: KeyRoundIcon },
  { section: EProjectSettingsSection.Mcp, label: 'MCP', icon: PlugIcon },
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
