import { EControlsPlacement } from '../layout/posture'
import { isSessionsPath, isTabRoot, pathnameOf, SESSIONS_HREF } from './tabs'

export const SETTINGS_HREF = '/settings'

export enum ENavigationAction {
  None = 'none',
  Push = 'push',
  Replace = 'replace',
  ResetStack = 'reset-stack',
}

export enum ESettingsPlacement {
  Root = 'root',
  Pushed = 'pushed',
}

export const settingsPlacementOf = ({
  controls,
}: {
  controls: EControlsPlacement
}): ESettingsPlacement =>
  controls === EControlsPlacement.Rail ? ESettingsPlacement.Root : ESettingsPlacement.Pushed

export type TNavigationAction =
  | { action: ENavigationAction.None }
  | { action: ENavigationAction.Push; href: string }
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

export const tabNavigationOf = ({
  href,
  pathname,
}: {
  href: string
  pathname: string
}): TNavigationAction => {
  const sameTab =
    pathnameOf(pathname) === pathnameOf(href) || (isSessionsPath(href) && isSessionsPath(pathname))
  return sameTab
    ? { action: ENavigationAction.None }
    : { action: ENavigationAction.ResetStack, href }
}

export const bottomBarVisibleOf = ({
  pathname,
  drawerOpen,
}: {
  pathname: string
  drawerOpen: boolean
}): boolean => (isSessionsPath(pathname) ? drawerOpen : isTabRoot(pathname))

export const accountNavigationOf = ({
  controls,
  pathname,
}: {
  controls: EControlsPlacement
  pathname: string
}): TNavigationAction => {
  if (settingsPlacementOf({ controls }) === ESettingsPlacement.Pushed)
    return { action: ENavigationAction.Push, href: SETTINGS_HREF }
  return pathnameOf(pathname) === SETTINGS_HREF
    ? { action: ENavigationAction.None }
    : { action: ENavigationAction.ResetStack, href: SETTINGS_HREF }
}
