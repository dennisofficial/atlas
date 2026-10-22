import {
  BellIcon,
  BookOpenTextIcon,
  BotIcon,
  BrainIcon,
  Building2Icon,
  GaugeIcon,
  KeyRoundIcon,
  PaletteIcon,
  PlugIcon,
  ServerIcon,
  ShieldIcon,
  UserIcon,
  UsersIcon,
  VariableIcon,
  type LucideIcon,
} from 'lucide-react'

export enum ESettingsScope {
  Personal = 'personal',
  Workspace = 'workspace',
}

export enum ESettingsPage {
  Account = 'account',
  Integrations = 'integrations',
  UsageSandboxes = 'usage-sandboxes',
  Instructions = 'instructions',
  Memory = 'memory',
  ModelsEffort = 'models-effort',
  Providers = 'providers',
  Secrets = 'secrets',
  Appearance = 'appearance',
  Notifications = 'notifications',
  Security = 'security',
  WorkspaceGeneral = 'workspace-general',
  WorkspaceMembers = 'workspace-members',
  WorkspaceSecrets = 'workspace-secrets',
  WorkspaceMcp = 'workspace-mcp',
}

export type SettingsNavItem = {
  page: ESettingsPage
  label: string
  icon: LucideIcon
}

export type SettingsNavGroup = {
  label?: string
  items: SettingsNavItem[]
}

export const PERSONAL_NAV: SettingsNavGroup[] = [
  {
    items: [
      { page: ESettingsPage.Account, label: 'Account', icon: UserIcon },
      { page: ESettingsPage.Integrations, label: 'Integrations & MCP', icon: PlugIcon },
    ],
  },
  {
    label: 'Usage',
    items: [{ page: ESettingsPage.UsageSandboxes, label: 'Sandboxes', icon: ServerIcon }],
  },
  {
    label: 'Agent',
    items: [
      { page: ESettingsPage.Instructions, label: 'Instructions', icon: BookOpenTextIcon },
      { page: ESettingsPage.Memory, label: 'Memory', icon: BrainIcon },
      { page: ESettingsPage.ModelsEffort, label: 'Models & Effort', icon: GaugeIcon },
      { page: ESettingsPage.Providers, label: 'Providers', icon: BotIcon },
    ],
  },
  {
    label: 'Library',
    items: [{ page: ESettingsPage.Secrets, label: 'Secrets & Env Vars', icon: VariableIcon }],
  },
  {
    label: 'Interface',
    items: [
      { page: ESettingsPage.Appearance, label: 'Appearance', icon: PaletteIcon },
      { page: ESettingsPage.Notifications, label: 'Notifications', icon: BellIcon },
    ],
  },
  {
    label: 'Security',
    items: [{ page: ESettingsPage.Security, label: 'Devices & Sessions', icon: ShieldIcon }],
  },
]

export const WORKSPACE_NAV: SettingsNavGroup[] = [
  {
    items: [
      { page: ESettingsPage.WorkspaceGeneral, label: 'General', icon: Building2Icon },
      { page: ESettingsPage.WorkspaceMembers, label: 'Members', icon: UsersIcon },
    ],
  },
  {
    label: 'Library',
    items: [
      { page: ESettingsPage.WorkspaceSecrets, label: 'Secrets & Env Vars', icon: KeyRoundIcon },
      { page: ESettingsPage.WorkspaceMcp, label: 'MCP Servers', icon: PlugIcon },
    ],
  },
]

const NAV_BY_SCOPE: Record<ESettingsScope, SettingsNavGroup[]> = {
  [ESettingsScope.Personal]: PERSONAL_NAV,
  [ESettingsScope.Workspace]: WORKSPACE_NAV,
}

export function navForScope(scope: ESettingsScope): SettingsNavGroup[] {
  return NAV_BY_SCOPE[scope]
}

export function scopeOfPage(page: ESettingsPage): ESettingsScope {
  const inWorkspace = WORKSPACE_NAV.some((group) => group.items.some((item) => item.page === page))
  return inWorkspace ? ESettingsScope.Workspace : ESettingsScope.Personal
}

export function firstPageOf(scope: ESettingsScope): ESettingsPage {
  const first = navForScope(scope)[0]?.items[0]
  if (!first) throw new Error(`settings scope ${scope} has no pages`)
  return first.page
}

export function labelOfPage(page: ESettingsPage): string {
  const all = [...PERSONAL_NAV, ...WORKSPACE_NAV].flatMap((group) => group.items)
  return all.find((item) => item.page === page)?.label ?? page
}

export function filterNav({
  groups,
  query,
}: {
  groups: SettingsNavGroup[]
  query: string
}): SettingsNavGroup[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return groups
  return groups
    .map((group) => {
      const groupMatches = group.label?.toLowerCase().includes(needle) ?? false
      const items = groupMatches
        ? group.items
        : group.items.filter((item) => item.label.toLowerCase().includes(needle))
      return { ...group, items }
    })
    .filter((group) => group.items.length > 0)
}

export function parseSettingsPage(value: string): ESettingsPage | null {
  return Object.values(ESettingsPage).find((page) => page === value) ?? null
}

export function hrefOfPage(page: ESettingsPage): string {
  return `/settings/${page}`
}
