import { describe, expect, it } from 'bun:test'

import { EControlsPlacement } from '../../layout/posture'
import {
  accountNavigationOf,
  bottomBarVisibleOf,
  ENavigationAction,
  ESettingsPlacement,
  sessionOpenOf,
  sessionsTabHrefOf,
  SETTINGS_HREF,
  settingsPlacementOf,
  tabNavigationOf,
} from '../root-navigation'

describe('tabNavigationOf', () => {
  it('resets the stack to the tab root from another tab', () => {
    expect(tabNavigationOf({ href: '/routines', pathname: '/projects' })).toEqual({
      action: ENavigationAction.ResetStack,
      href: '/routines',
    })
    expect(tabNavigationOf({ href: '/artifacts', pathname: '/sessions' })).toEqual({
      action: ENavigationAction.ResetStack,
      href: '/artifacts',
    })
  })

  it('resets the stack to the tab root from a page pushed on top', () => {
    expect(tabNavigationOf({ href: '/sessions', pathname: '/settings' })).toEqual({
      action: ENavigationAction.ResetStack,
      href: '/sessions',
    })
    expect(tabNavigationOf({ href: '/routines', pathname: '/agents/agent_1' })).toEqual({
      action: ENavigationAction.ResetStack,
      href: '/routines',
    })
  })

  it('pops a tab to its own root from a page nested under it', () => {
    expect(tabNavigationOf({ href: '/routines', pathname: '/routines/run_1' })).toEqual({
      action: ENavigationAction.ResetStack,
      href: '/routines',
    })
  })

  it('does nothing on the tab root it already shows', () => {
    expect(tabNavigationOf({ href: '/sessions', pathname: '/sessions' })).toEqual({
      action: ENavigationAction.None,
    })
    expect(tabNavigationOf({ href: '/routines', pathname: '/routines/' })).toEqual({
      action: ENavigationAction.None,
    })
  })

  it('does nothing on the sessions tab while it shows a session', () => {
    expect(tabNavigationOf({ href: '/sessions/ses_1', pathname: '/sessions/ses_1' })).toEqual({
      action: ENavigationAction.None,
    })
    expect(tabNavigationOf({ href: '/sessions/ses_1', pathname: '/sessions' })).toEqual({
      action: ENavigationAction.None,
    })
  })
})

describe('sessionsTabHrefOf', () => {
  it('opens the sessions root with no selection', () => {
    expect(sessionsTabHrefOf({ selected: null })).toBe('/sessions')
  })

  it('opens the selected session', () => {
    expect(sessionsTabHrefOf({ selected: 'ses_1' })).toBe('/sessions/ses_1')
  })

  it('encodes an id that holds a path separator', () => {
    expect(sessionsTabHrefOf({ selected: 'a/b' })).toBe('/sessions/a%2Fb')
  })
})

describe('sessionOpenOf', () => {
  it('replaces the current session inside the sessions tab', () => {
    expect(sessionOpenOf({ pathname: '/sessions', id: 'ses_2' })).toEqual({
      action: ENavigationAction.Replace,
      href: '/sessions/ses_2',
    })
    expect(sessionOpenOf({ pathname: '/sessions/ses_1', id: 'ses_2' })).toEqual({
      action: ENavigationAction.Replace,
      href: '/sessions/ses_2',
    })
  })

  it('resets the stack onto the session from another tab', () => {
    expect(sessionOpenOf({ pathname: '/routines', id: 'ses_2' })).toEqual({
      action: ENavigationAction.ResetStack,
      href: '/sessions/ses_2',
    })
    expect(sessionOpenOf({ pathname: '/settings', id: 'ses_2' })).toEqual({
      action: ENavigationAction.ResetStack,
      href: '/sessions/ses_2',
    })
  })
})

describe('bottomBarVisibleOf', () => {
  it('shows the bar on the other tab roots', () => {
    expect(bottomBarVisibleOf({ pathname: '/routines', drawerOpen: false })).toBe(true)
    expect(bottomBarVisibleOf({ pathname: '/projects', drawerOpen: false })).toBe(true)
  })

  it('shows the bar on the sessions tab only while the drawer is open', () => {
    expect(bottomBarVisibleOf({ pathname: '/sessions', drawerOpen: true })).toBe(true)
    expect(bottomBarVisibleOf({ pathname: '/sessions/ses_1', drawerOpen: true })).toBe(true)
    expect(bottomBarVisibleOf({ pathname: '/sessions', drawerOpen: false })).toBe(false)
    expect(bottomBarVisibleOf({ pathname: '/sessions/ses_1', drawerOpen: false })).toBe(false)
  })

  it('hides the bar on a pushed page', () => {
    expect(bottomBarVisibleOf({ pathname: '/settings', drawerOpen: true })).toBe(false)
    expect(bottomBarVisibleOf({ pathname: '/new', drawerOpen: false })).toBe(false)
  })
})

describe('accountNavigationOf', () => {
  it('resets the stack to Settings alone in the rail posture', () => {
    expect(
      accountNavigationOf({ controls: EControlsPlacement.Rail, pathname: '/sessions' }),
    ).toEqual({
      action: ENavigationAction.ResetStack,
      href: SETTINGS_HREF,
    })
    expect(
      accountNavigationOf({ controls: EControlsPlacement.Rail, pathname: '/sessions/ses_1' }),
    ).toEqual({ action: ENavigationAction.ResetStack, href: SETTINGS_HREF })
  })

  it('does nothing on Settings in the rail posture', () => {
    expect(
      accountNavigationOf({ controls: EControlsPlacement.Rail, pathname: SETTINGS_HREF }),
    ).toEqual({ action: ENavigationAction.None })
  })

  it('pushes Settings from the bottom bar posture so a back button exists', () => {
    expect(
      accountNavigationOf({ controls: EControlsPlacement.BottomBar, pathname: '/sessions' }),
    ).toEqual({
      action: ENavigationAction.Push,
      href: SETTINGS_HREF,
    })
  })
})

describe('settingsPlacementOf', () => {
  it('treats Settings as a root that appears in place in the rail posture', () => {
    expect(settingsPlacementOf({ controls: EControlsPlacement.Rail })).toBe(ESettingsPlacement.Root)
  })

  it('treats Settings as a pushed page with a back swipe in the bottom bar posture', () => {
    expect(settingsPlacementOf({ controls: EControlsPlacement.BottomBar })).toBe(
      ESettingsPlacement.Pushed,
    )
  })
})
