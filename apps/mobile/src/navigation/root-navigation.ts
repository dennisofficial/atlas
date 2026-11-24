import { EControlsPlacement } from '../layout/posture'
import { pathnameOf } from './tabs'

export const SETTINGS_HREF = '/settings'

export enum ENavigationAction {
  None = 'none',
  Push = 'push',
  ResetStack = 'reset-stack',
}

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
  if (controls !== EControlsPlacement.Rail)
    return { action: ENavigationAction.Push, href: SETTINGS_HREF }
  return pathnameOf(pathname) === SETTINGS_HREF
    ? { action: ENavigationAction.None }
    : { action: ENavigationAction.ResetStack, href: SETTINGS_HREF }
}
