import { BoxIcon, LayoutDashboardIcon, PlugIcon, VariableIcon, type LucideIcon } from 'lucide-react'

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
  { section: EProjectSettingsSection.Secrets, label: 'Secrets & Env Vars', icon: VariableIcon },
  { section: EProjectSettingsSection.Mcp, label: 'MCP', icon: PlugIcon },
]

export function parseProjectSection(value: string): EProjectSettingsSection | null {
  return Object.values(EProjectSettingsSection).find((section) => section === value) ?? null
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
