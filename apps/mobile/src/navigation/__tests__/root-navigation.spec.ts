import { describe, expect, it } from 'bun:test'

import {
  ENavigationAction,
  sessionOpenOf,
  sessionsTabHrefOf,
  SETTINGS_HREF,
  tabBarHiddenOf,
} from '../root-navigation'

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
    expect(sessionOpenOf({ pathname: SETTINGS_HREF, id: 'ses_2' })).toEqual({
      action: ENavigationAction.ResetStack,
      href: '/sessions/ses_2',
    })
  })
})

describe('tabBarHiddenOf', () => {
  it('shows the bar on the other tabs', () => {
    expect(tabBarHiddenOf({ pathname: '/routines', drawerOpen: false })).toBe(false)
    expect(tabBarHiddenOf({ pathname: '/projects', drawerOpen: false })).toBe(false)
    expect(tabBarHiddenOf({ pathname: '/artifacts', drawerOpen: false })).toBe(false)
  })

  it('hides the bar on the sessions tab while the drawer is closed', () => {
    expect(tabBarHiddenOf({ pathname: '/sessions', drawerOpen: false })).toBe(true)
    expect(tabBarHiddenOf({ pathname: '/sessions/ses_1', drawerOpen: false })).toBe(true)
  })

  it('shows the bar on the sessions tab while the drawer is open', () => {
    expect(tabBarHiddenOf({ pathname: '/sessions', drawerOpen: true })).toBe(false)
    expect(tabBarHiddenOf({ pathname: '/sessions/ses_1', drawerOpen: true })).toBe(false)
  })

  it('keeps the bar over a page pushed above the tabs', () => {
    expect(tabBarHiddenOf({ pathname: SETTINGS_HREF, drawerOpen: false })).toBe(false)
    expect(tabBarHiddenOf({ pathname: '/new', drawerOpen: false })).toBe(false)
  })
})
