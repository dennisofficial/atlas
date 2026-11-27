export enum ESettingsPage {
  Account = 'account',
  Integrations = 'integrations',
  Instructions = 'instructions',
  Skills = 'skills',
  Memory = 'memory',
  ModelsEffort = 'models-effort',
  Providers = 'providers',
  Classifier = 'classifier',
  Access = 'access',
  Groups = 'groups',
  Appearance = 'appearance',
  Notifications = 'notifications',
  Security = 'security',
  Agent = 'agent',
  Experimental = 'experimental',
  Quality = 'quality',
}

export type ISettingsPageItem = {
  page: ESettingsPage
  label: string
}

export type INavGroup<TItem extends { label: string }> = {
  label?: string
  items: TItem[]
}

export const SETTINGS_NAV: INavGroup<ISettingsPageItem>[] = [
  {
    items: [
      { page: ESettingsPage.Account, label: 'Account' },
      { page: ESettingsPage.Integrations, label: 'Integrations & MCP' },
    ],
  },
  {
    label: 'Agent',
    items: [
      { page: ESettingsPage.Instructions, label: 'Instructions' },
      { page: ESettingsPage.Skills, label: 'Skills' },
      { page: ESettingsPage.Memory, label: 'Memory' },
      { page: ESettingsPage.ModelsEffort, label: 'Models & Effort' },
      { page: ESettingsPage.Providers, label: 'Providers' },
      { page: ESettingsPage.Classifier, label: 'Classifier' },
      { page: ESettingsPage.Agent, label: 'Agent' },
      { page: ESettingsPage.Quality, label: 'Code Quality' },
      { page: ESettingsPage.Experimental, label: 'Experimental' },
    ],
  },
  {
    label: 'Library',
    items: [
      { page: ESettingsPage.Access, label: 'Access' },
      { page: ESettingsPage.Groups, label: 'Groups' },
    ],
  },
  {
    label: 'Interface',
    items: [
      { page: ESettingsPage.Appearance, label: 'Appearance' },
      { page: ESettingsPage.Notifications, label: 'Notifications' },
    ],
  },
  {
    label: 'Security',
    items: [{ page: ESettingsPage.Security, label: 'Devices & Sessions' }],
  },
]

export const labelOfPage = (page: ESettingsPage): string =>
  SETTINGS_NAV.flatMap((group) => group.items).find((item) => item.page === page)?.label ?? page

export const filterNav = <TItem extends { label: string }>({
  groups,
  query,
}: {
  groups: INavGroup<TItem>[]
  query: string
}): INavGroup<TItem>[] => {
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
