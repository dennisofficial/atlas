import {
  BellIcon,
  BookOpenTextIcon,
  BotIcon,
  BrainIcon,
  GaugeIcon,
  PaletteIcon,
  PlugIcon,
  ServerIcon,
  ShieldIcon,
  UserIcon,
  VariableIcon,
  WrenchIcon,
  type LucideIcon,
} from 'lucide-react'

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
  Agent = 'agent',
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

export const SETTINGS_NAV: SettingsNavGroup[] = [
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
      { page: ESettingsPage.Agent, label: 'Agent', icon: WrenchIcon },
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

export function labelOfPage(page: ESettingsPage): string {
  const all = SETTINGS_NAV.flatMap((group) => group.items)
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

export function settingsPageOfPath(pathname: string): ESettingsPage | null {
  if (!pathname.startsWith('/settings/')) return null
  const segment = pathname.split('/')[2]
  return Object.values(ESettingsPage).find((page) => page === segment) ?? null
}

export function hrefOfPage(page: ESettingsPage): string {
  return `/settings/${page}`
}
