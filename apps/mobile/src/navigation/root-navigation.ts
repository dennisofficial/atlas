import { isSessionsPath, SESSIONS_HREF } from './tabs'

export const SETTINGS_HREF = '/settings'

export enum ENavigationAction {
  None = 'none',
  Replace = 'replace',
  ResetStack = 'reset-stack',
}

export type TNavigationAction =
  | { action: ENavigationAction.None }
  | { action: ENavigationAction.Replace; href: string }
  | { action: ENavigationAction.ResetStack; href: string }

export const sessionsTabHrefOf = ({ selected }: { selected: string | null }): string =>
  selected === null ? SESSIONS_HREF : `${SESSIONS_HREF}/${encodeURIComponent(selected)}`

export const sessionOpenOf = ({
  pathname,
  id,
}: {
  pathname: string
  id: string
}): TNavigationAction => {
  const href = sessionsTabHrefOf({ selected: id })
  if (isSessionsPath(pathname)) return { action: ENavigationAction.Replace, href }
  return { action: ENavigationAction.ResetStack, href }
}

export const tabBarHiddenOf = ({
  pathname,
  drawerOpen,
}: {
  pathname: string
  drawerOpen: boolean
}): boolean => isSessionsPath(pathname) && !drawerOpen
