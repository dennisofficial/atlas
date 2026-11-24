import { describe, expect, it } from 'bun:test'

import { PANEL_WIDTH } from '../../layout/pane-layout'
import { ESessionsListLayout } from '../../layout/posture'
import { OVERLAY_MIN_WIDTH, OVERLAY_WIDTH_RATIO } from '../sessions-overlay'
import { drawerGeometryOf } from '../drawer-layout'

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
