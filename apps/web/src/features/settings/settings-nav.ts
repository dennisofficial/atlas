import {
  ESettingsPage,
  filterNav,
  type INavGroup,
  labelOfPage,
  SETTINGS_NAV as SHARED_SETTINGS_NAV,
} from '@dltech/atlas-client/settings'
import {
  BellIcon,
  BookOpenTextIcon,
  BotIcon,
  BrainIcon,
  FlaskConicalIcon,
  FolderIcon,
  GaugeIcon,
  LockKeyholeIcon,
  PaletteIcon,
  PlugIcon,
  ScaleIcon,
  ShieldCheckIcon,
  ShieldIcon,
  SparklesIcon,
  UserIcon,
  WrenchIcon,
  type LucideIcon,
} from 'lucide-react'

export { ESettingsPage, filterNav, labelOfPage }

export type SettingsNavItem = {
  page: ESettingsPage
  label: string
  icon: LucideIcon
}

export type SettingsNavGroup = INavGroup<SettingsNavItem>

const ICONS: Record<ESettingsPage, LucideIcon> = {
  [ESettingsPage.Account]: UserIcon,
  [ESettingsPage.Integrations]: PlugIcon,
  [ESettingsPage.Instructions]: BookOpenTextIcon,
  [ESettingsPage.Skills]: SparklesIcon,
  [ESettingsPage.Memory]: BrainIcon,
  [ESettingsPage.ModelsEffort]: GaugeIcon,
  [ESettingsPage.Providers]: BotIcon,
  [ESettingsPage.Classifier]: ScaleIcon,
  [ESettingsPage.Agent]: WrenchIcon,
  [ESettingsPage.Quality]: ShieldCheckIcon,
  [ESettingsPage.Experimental]: FlaskConicalIcon,
  [ESettingsPage.Access]: LockKeyholeIcon,
  [ESettingsPage.Groups]: FolderIcon,
  [ESettingsPage.Appearance]: PaletteIcon,
  [ESettingsPage.Notifications]: BellIcon,
  [ESettingsPage.Security]: ShieldIcon,
}

export const SETTINGS_NAV: SettingsNavGroup[] = SHARED_SETTINGS_NAV.map((group) => ({
  ...(group.label === undefined ? {} : { label: group.label }),
  items: group.items.map((item) => ({ ...item, icon: ICONS[item.page] })),
}))

export function settingsPageOfPath(pathname: string): ESettingsPage | null {
  if (!pathname.startsWith('/settings/')) return null
  const segment = pathname.split('/')[2]
  return Object.values(ESettingsPage).find((page) => page === segment) ?? null
}

export function hrefOfPage(page: ESettingsPage): string {
  return `/settings/${page}`
}

export const PROVIDERS_HREF = hrefOfPage(ESettingsPage.Providers)
