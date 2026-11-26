import { describe, expect, it } from 'bun:test'

import { PANEL_WIDTH } from '../../layout/pane-layout'
import { ESessionsListLayout } from '../../layout/posture'
import { OVERLAY_MIN_WIDTH, OVERLAY_WIDTH_RATIO } from '../sessions-overlay'
import {
  drawerDockedOf,
  drawerGeometryOf,
  drawerOpenByDefaultOf,
  drawerScopeOf,
  drawerSwipeEnabledOf,
  opensDrawerWithoutSessionOf,
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
