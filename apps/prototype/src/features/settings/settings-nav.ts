import {
  BookOpenTextIcon,
  BotIcon,
  BrainIcon,
  GaugeIcon,
  GitBranchIcon,
  PaletteIcon,
  PlugIcon,
  ServerIcon,
  UserIcon,
  VariableIcon,
  type LucideIcon,
} from 'lucide-react'

export enum ESettingsPage {
  Account = 'account',
  Providers = 'providers',
  Github = 'github',
  Sandbox = 'sandbox',
  Secrets = 'secrets',
  Mcp = 'mcp',
  Instructions = 'instructions',
  Memory = 'memory',
  ModelsEffort = 'models-effort',
  Appearance = 'appearance',
  Notifications = 'notifications',
  Security = 'security',
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
      { page: ESettingsPage.Providers, label: 'Providers', icon: BotIcon },
    ],
  },
  {
    label: 'Cloud',
    items: [
      { page: ESettingsPage.Github, label: 'GitHub', icon: GitBranchIcon },
      { page: ESettingsPage.Sandbox, label: 'Sandbox', icon: ServerIcon },
      { page: ESettingsPage.Secrets, label: 'Secrets & Env Vars', icon: VariableIcon },
      { page: ESettingsPage.Mcp, label: 'MCP', icon: PlugIcon },
    ],
  },
  {
    label: 'Agent',
    items: [
      { page: ESettingsPage.Instructions, label: 'Instructions', icon: BookOpenTextIcon },
      { page: ESettingsPage.Memory, label: 'Memory', icon: BrainIcon },
      { page: ESettingsPage.ModelsEffort, label: 'Models & Effort', icon: GaugeIcon },
    ],
  },
  {
    label: 'Interface',
    items: [{ page: ESettingsPage.Appearance, label: 'Appearance', icon: PaletteIcon }],
  },
]

export function labelOfPage(page: ESettingsPage): string {
  const all = PERSONAL_NAV.flatMap((group) => group.items)
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
