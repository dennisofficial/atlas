import { describe, expect, it } from 'bun:test'

import { PANEL_WIDTH } from '../../layout/pane-layout'
import { ESessionsListLayout } from '../../layout/posture'
import { OVERLAY_MIN_WIDTH, OVERLAY_WIDTH_RATIO } from '../sessions-overlay'
import { drawerGeometryOf, drawerSwipeEnabledOf } from '../drawer-layout'

describe('drawerGeometryOf', () => {
  it('opens full width over the session on an iPhone', () => {
    expect(drawerGeometryOf({ listLayout: ESessionsListLayout.Stacked, width: 430 })).toEqual({
      permanent: false,
      width: 430,
    })
  })

  it('takes a bit over half the window on a Duo unfolded portrait', () => {
    expect(drawerGeometryOf({ listLayout: ESessionsListLayout.Overlay, width: 703 })).toEqual({
      permanent: false,
      width: Math.round(703 * OVERLAY_WIDTH_RATIO),
    })
    expect(drawerGeometryOf({ listLayout: ESessionsListLayout.Overlay, width: 500 }).width).toBe(
      OVERLAY_MIN_WIDTH,
    )
  })

  it('keeps a fixed panel beside the session on a wide landscape window', () => {
    expect(drawerGeometryOf({ listLayout: ESessionsListLayout.Panel, width: 1000 })).toEqual({
      permanent: true,
      width: PANEL_WIDTH,
    })
  })
})

describe('drawerSwipeEnabledOf', () => {
  it('opens by swipe while the drawer is closed', () => {
    expect(drawerSwipeEnabledOf({ geometry: { permanent: false, width: 430 }, open: false })).toBe(
      true,
    )
  })

  it('leaves a left swipe on an open drawer to the session rows', () => {
    expect(drawerSwipeEnabledOf({ geometry: { permanent: false, width: 430 }, open: true })).toBe(
      false,
    )
  })

  it('never swipes a permanent panel', () => {
    expect(
      drawerSwipeEnabledOf({ geometry: { permanent: true, width: PANEL_WIDTH }, open: false }),
    ).toBe(false)
  })
})
