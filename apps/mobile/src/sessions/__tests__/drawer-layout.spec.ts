import { describe, expect, it } from 'bun:test'

import { PANEL_WIDTH } from '../../layout/pane-layout'
import { ESessionsListLayout } from '../../layout/posture'
import { OVERLAY_MIN_WIDTH, OVERLAY_WIDTH_RATIO } from '../sessions-overlay'
import {
  drawerDockedOf,
  drawerGeometryOf,
  drawerHidableOf,
  drawerOpenByDefaultOf,
  drawerScopeOf,
  drawerSwipeEnabledOf,
  opensDrawerWithoutSessionOf,
  paneWidthOf,
  showsHideSessionsButtonOf,
} from '../drawer-layout'

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

describe('opensDrawerWithoutSessionOf', () => {
  it('shows the sessions list on an iPhone with no session open', () => {
    expect(
      opensDrawerWithoutSessionOf({ listLayout: ESessionsListLayout.Stacked, selected: null }),
    ).toBe(true)
  })

  it('keeps the drawer closed by default on a Duo unfolded portrait', () => {
    expect(
      opensDrawerWithoutSessionOf({ listLayout: ESessionsListLayout.Overlay, selected: null }),
    ).toBe(false)
  })

  it('never opens the drawer over an open session', () => {
    expect(
      opensDrawerWithoutSessionOf({ listLayout: ESessionsListLayout.Stacked, selected: 'ses_a' }),
    ).toBe(false)
  })
})

describe('drawerSwipeEnabledOf', () => {
  const drawer = { permanent: false, width: 430 }

  it('opens by swipe while the drawer is closed', () => {
    expect(drawerSwipeEnabledOf({ geometry: drawer, open: false, hidable: false })).toBe(true)
  })

  it('closes by swipe over an open session', () => {
    expect(drawerSwipeEnabledOf({ geometry: drawer, open: true, hidable: true })).toBe(true)
  })

  it('keeps the list in place when no session sits behind it', () => {
    expect(drawerSwipeEnabledOf({ geometry: drawer, open: true, hidable: false })).toBe(false)
  })

  it('never swipes a permanent panel', () => {
    expect(
      drawerSwipeEnabledOf({
        geometry: { permanent: true, width: PANEL_WIDTH },
        open: false,
        hidable: true,
      }),
    ).toBe(false)
  })
})

describe('drawerHidableOf', () => {
  it('hides the iPhone list only when a session sits behind it', () => {
    expect(drawerHidableOf({ listLayout: ESessionsListLayout.Stacked, selected: 'ses_a' })).toBe(
      true,
    )
    expect(drawerHidableOf({ listLayout: ESessionsListLayout.Stacked, selected: null })).toBe(false)
  })

  it('always hides the overlay and the panel', () => {
    expect(drawerHidableOf({ listLayout: ESessionsListLayout.Overlay, selected: null })).toBe(true)
    expect(drawerHidableOf({ listLayout: ESessionsListLayout.Panel, selected: null })).toBe(true)
  })
})

describe('showsHideSessionsButtonOf', () => {
  it('offers the hide button beside the content in the panel', () => {
    expect(
      showsHideSessionsButtonOf({ listLayout: ESessionsListLayout.Panel, selected: null }),
    ).toBe(true)
  })

  it('offers the hide button on the full-width list when a session sits behind it', () => {
    expect(
      showsHideSessionsButtonOf({ listLayout: ESessionsListLayout.Stacked, selected: 'ses_a' }),
    ).toBe(true)
  })

  it('leaves out the hide button on the full-width list with no session behind it', () => {
    expect(
      showsHideSessionsButtonOf({ listLayout: ESessionsListLayout.Stacked, selected: null }),
    ).toBe(false)
  })

  it('leaves the overlay to a tap outside or a swipe', () => {
    expect(
      showsHideSessionsButtonOf({ listLayout: ESessionsListLayout.Overlay, selected: 'ses_a' }),
    ).toBe(false)
  })
})

describe('drawerOpenByDefaultOf', () => {
  it('opens the panel by default in landscape and closes the drawer elsewhere', () => {
    expect(drawerOpenByDefaultOf({ listLayout: ESessionsListLayout.Panel })).toBe(true)
    expect(drawerOpenByDefaultOf({ listLayout: ESessionsListLayout.Overlay })).toBe(false)
    expect(drawerOpenByDefaultOf({ listLayout: ESessionsListLayout.Stacked })).toBe(false)
  })
})

describe('drawerScopeOf', () => {
  it('keeps a hidden panel hidden when another session opens', () => {
    expect(drawerScopeOf({ listLayout: ESessionsListLayout.Panel, selected: 'ses_a' })).toEqual({
      layout: ESessionsListLayout.Panel,
      screen: null,
    })
  })

  it('scopes the overlay drawer to the open session', () => {
    expect(drawerScopeOf({ listLayout: ESessionsListLayout.Overlay, selected: 'ses_a' })).toEqual({
      layout: ESessionsListLayout.Overlay,
      screen: 'ses_a',
    })
  })
})

describe('drawerDockedOf', () => {
  it('docks the panel beside the session only while it is open', () => {
    const panel = { permanent: true, width: PANEL_WIDTH }
    expect(drawerDockedOf({ geometry: panel, open: true })).toBe(true)
    expect(drawerDockedOf({ geometry: panel, open: false })).toBe(false)
    expect(drawerDockedOf({ geometry: { permanent: false, width: 430 }, open: true })).toBe(false)
  })
})

describe('paneWidthOf', () => {
  it('leaves the session pane the frame width minus the docked panel', () => {
    expect(
      paneWidthOf({ listLayout: ESessionsListLayout.Panel, width: 956, drawerOpen: true }),
    ).toBe(956 - PANEL_WIDTH)
  })

  it('gives the pane the whole frame when the panel is hidden or the list floats', () => {
    expect(
      paneWidthOf({ listLayout: ESessionsListLayout.Panel, width: 956, drawerOpen: false }),
    ).toBe(956)
    expect(
      paneWidthOf({ listLayout: ESessionsListLayout.Overlay, width: 744, drawerOpen: true }),
    ).toBe(744)
    expect(
      paneWidthOf({ listLayout: ESessionsListLayout.Stacked, width: 440, drawerOpen: true }),
    ).toBe(440)
  })
})
