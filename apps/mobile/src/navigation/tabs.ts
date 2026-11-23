export enum EAppTab {
  Threads = 'threads',
  Routines = 'routines',
  Projects = 'projects',
  Artifacts = 'artifacts',
}

export type TAppTabItem = { tab: EAppTab; label: string; href: string }

export const APP_TAB_ITEMS: Record<EAppTab, TAppTabItem> = {
  [EAppTab.Threads]: { tab: EAppTab.Threads, label: 'Threads', href: '/' },
  [EAppTab.Routines]: { tab: EAppTab.Routines, label: 'Routines', href: '/routines' },
  [EAppTab.Projects]: { tab: EAppTab.Projects, label: 'Projects', href: '/projects' },
  [EAppTab.Artifacts]: { tab: EAppTab.Artifacts, label: 'Artifacts', href: '/artifacts' },
}

export const APP_TABS: readonly TAppTabItem[] = Object.values(APP_TAB_ITEMS)

const pathnameOf = (pathname: string): string => {
  const trimmed = pathname.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

export const activeTabOf = (pathname: string): EAppTab | null =>
  APP_TABS.find((item) => item.href === pathnameOf(pathname))?.tab ?? null

export const isTabRoot = (pathname: string): boolean => activeTabOf(pathname) !== null
