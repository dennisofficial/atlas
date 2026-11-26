import { PANEL_WIDTH } from '../layout/pane-layout'
import { ESessionsListLayout } from '../layout/posture'
import type { TOverlayScope } from '../layout/scoped-overlay'
import { overlayWidthOf } from './sessions-overlay'

export type TDrawerGeometry = { permanent: boolean; width: number }

export const drawerGeometryOf = ({
  listLayout,
  width,
}: {
  listLayout: ESessionsListLayout
  width: number
}): TDrawerGeometry => {
  if (listLayout === ESessionsListLayout.Panel) return { permanent: true, width: PANEL_WIDTH }
  if (listLayout === ESessionsListLayout.Overlay)
    return { permanent: false, width: overlayWidthOf(width) }
  return { permanent: false, width }
}

export const opensDrawerWithoutSessionOf = ({
  listLayout,
  selected,
}: {
  listLayout: ESessionsListLayout
  selected: string | null
}): boolean => selected === null && listLayout === ESessionsListLayout.Stacked

export const drawerHidableOf = ({
  listLayout,
  selected,
}: {
  listLayout: ESessionsListLayout
  selected: string | null
}): boolean => !opensDrawerWithoutSessionOf({ listLayout, selected })

export const showsHideSessionsButtonOf = ({
  listLayout,
}: {
  listLayout: ESessionsListLayout
}): boolean => listLayout === ESessionsListLayout.Panel

export const drawerSwipeEnabledOf = ({
  geometry,
  open,
  hidable,
}: {
  geometry: TDrawerGeometry
  open: boolean
  hidable: boolean
}): boolean => !geometry.permanent && (!open || hidable)

export const drawerOpenByDefaultOf = ({
  listLayout,
}: {
  listLayout: ESessionsListLayout
}): boolean => listLayout === ESessionsListLayout.Panel

export const drawerScopeOf = ({
  listLayout,
  selected,
}: {
  listLayout: ESessionsListLayout
  selected: string | null
}): TOverlayScope => ({
  layout: listLayout,
  screen: listLayout === ESessionsListLayout.Panel ? null : selected,
})

export const drawerDockedOf = ({
  geometry,
  open,
}: {
  geometry: TDrawerGeometry
  open: boolean
}): boolean => geometry.permanent && open
