export enum EAppTab {
  Sessions = 'sessions',
  Routines = 'routines',
  Projects = 'projects',
  Artifacts = 'artifacts',
}

export type TAppTabItem = { tab: EAppTab; label: string; href: string }

export const SESSIONS_HREF = '/sessions'

export const APP_TAB_ITEMS: Record<EAppTab, TAppTabItem> = {
  [EAppTab.Sessions]: { tab: EAppTab.Sessions, label: 'Sessions', href: SESSIONS_HREF },
  [EAppTab.Routines]: { tab: EAppTab.Routines, label: 'Routines', href: '/routines' },
  [EAppTab.Projects]: { tab: EAppTab.Projects, label: 'Projects', href: '/projects' },
  [EAppTab.Artifacts]: { tab: EAppTab.Artifacts, label: 'Artifacts', href: '/artifacts' },
}

export const APP_TABS: readonly TAppTabItem[] = Object.values(APP_TAB_ITEMS)

export const pathnameOf = (pathname: string): string => {
  const trimmed = pathname.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

export const isSessionsPath = (pathname: string): boolean => {
  const path = pathnameOf(pathname)
  return path === SESSIONS_HREF || path.startsWith(`${SESSIONS_HREF}/`)
}

export const activeTabOf = (pathname: string): EAppTab | null => {
  if (isSessionsPath(pathname)) return EAppTab.Sessions
  const path = pathnameOf(pathname)
  return APP_TABS.find((item) => pathnameOf(item.href) === path)?.tab ?? null
}

export const isTabRoot = (pathname: string): boolean => {
  const path = pathnameOf(pathname)
  return APP_TABS.some((item) => pathnameOf(item.href) === path)
}
