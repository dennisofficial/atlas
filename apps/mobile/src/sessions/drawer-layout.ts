import { PANEL_WIDTH } from '../layout/pane-layout'
import { ESessionsListLayout } from '../layout/posture'
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

export const drawerSwipeEnabledOf = ({
  geometry,
  open,
}: {
  geometry: TDrawerGeometry
  open: boolean
}): boolean => !geometry.permanent && !open
