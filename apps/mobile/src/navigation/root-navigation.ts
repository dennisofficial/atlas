import { EControlsPlacement } from '../layout/posture'
import { pathnameOf } from './tabs'

export const SETTINGS_HREF = '/settings'

export enum ENavigationAction {
  None = 'none',
  Push = 'push',
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
  | { action: ENavigationAction.ResetStack; href: string }

export const tabNavigationOf = ({
  href,
  pathname,
}: {
  href: string
  pathname: string
}): TNavigationAction =>
  pathnameOf(pathname) === pathnameOf(href)
    ? { action: ENavigationAction.None }
    : { action: ENavigationAction.ResetStack, href }

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
